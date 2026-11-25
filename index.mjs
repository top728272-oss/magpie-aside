import {
  createCatalogCache,
  fallbackModels,
  fetchCatalog,
  filterModels,
  modelsFromCatalog,
  normalizeCatalog,
} from "./src/catalog.mjs";
import {
  BILLING_TIMEOUT_MS,
  BILLING_TTL_ERR_MS,
  BILLING_TTL_OK_MS,
  DEFAULT_OPTIONS,
  FALLBACK_SNAPSHOT_DATE,
  MODE_BROWSER,
  MODE_GOOGLE,
  NPM_OPENAI_COMPATIBLE,
  PROVIDER,
  VERSION,
} from "./src/constants.mjs";
import { fetchBilling, normalizeBilling } from "./src/billing.mjs";
import { credentialsPath } from "./src/credentials.mjs";
import {
  apiBase,
  baseHeaders,
  createLoader,
  modelIdFromBody,
  normalizeIncomingUrl,
  sessionHeaders,
} from "./src/fetch.mjs";
import { ICON_DATA_URI } from "./src/icon.mjs";
import { resolveLang, t } from "./src/i18n.mjs";
import {
  compareVersions,
  createGoogleMethod,
  findAsideApp,
  launchAside,
  waitForSession,
} from "./src/google.mjs";
import { createMethods, verifyAccessToken } from "./src/login.mjs";
import { accountIdFor, resolveAccountSettings } from "./src/modes.mjs";
import {
  createSessionStore,
  requestTokenRefresh,
  writeSessionBack,
} from "./src/session.mjs";
import {
  buildBillingUsage,
  buildUsage,
  buildUsageError,
} from "./src/usage.mjs";
import { describeError, tokenClaims } from "./src/util.mjs";

export function resolveOptions(input, options) {
  const merged = {
    ...DEFAULT_OPTIONS,
    ...(options && typeof options === "object" ? options : {}),
    ...(input?.magpie?.options && typeof input.magpie.options === "object"
      ? input.magpie.options
      : {}),
    ...(input?.magpie?.option && typeof input.magpie.option === "object"
      ? input.magpie.option
      : {}),
  };
  return {
    ...merged,
    baseOrigin: String(merged.baseOrigin || DEFAULT_OPTIONS.baseOrigin).trim(),
    dataDir: String(merged.dataDir ?? "").trim(),
    allowRefresh: merged.allowRefresh !== false,
  };
}

export const AsidePlugin = async (input = {}, options = {}) => {
  const opts = resolveOptions(input, options);
  const lang = resolveLang(opts);
  const fetchImpl = globalThis.fetch;
  const catalogCache = createCatalogCache();

  const log = async (level, message) => {
    try {
      await input?.client?.app?.log?.({
        body: { service: "magpie-aside", level, message },
      });
    } catch {
      void 0;
    }
    if (opts.debug) console.error(`[magpie-aside] ${level}: ${message}`);
  };

  const sessions = createSessionStore({
    options: opts,
    deps: {
      fetchImpl,
      onRefresh: (event) => {
        const written = event?.written?.ok === true ? "written" : "not-written";
        log(
          "info",
          `token refreshed: expires ${new Date(event.expiresAt).toISOString()} (${written})`,
        );
      },
    },
  });

  function browserPath(settings) {
    return credentialsPath({ explicitDir: settings.dataDir });
  }

  async function accountContext(auth) {
    const settings = resolveAccountSettings(auth, opts);

    if (settings.mode !== MODE_BROWSER) {
      const token = settings.access || settings.key;
      const claims = token ? tokenClaims(token) : null;
      return {
        settings: {
          ...settings,
          email: String(claims?.email ?? "").trim() || settings.email,
          plan: String(claims?.plan ?? "").trim() || settings.plan,
        },
        session: {
          token,
          expiresAt: settings.expires || claims?.expiresAt || 0,
          email: String(claims?.email ?? "").trim() || settings.email,
          plan: String(claims?.plan ?? "").trim() || settings.plan,
        },
      };
    }

    const info = sessions.peek(browserPath(settings));
    if (!info.ok) return { settings, session: null, error: info };

    return {
      settings: {
        ...settings,
        email: info.email || settings.email,
        plan: info.plan || settings.plan,
      },
      session: {
        token: info.token,
        expiresAt: info.expiresAt,
        email: info.email,
        plan: info.plan,
      },
    };
  }

  async function loadCatalog(settings) {
    return catalogCache.get(settings.origin, () =>
      fetchCatalog(settings.origin, { fetchImpl }),
    );
  }

  const provider = {
    id: PROVIDER,
    async models(p, ctx = {}) {
      const auth = ctx?.auth;
      const base = p?.models ?? {};
      const showHiddenModels = opts.showHiddenModels === true;
      if (!auth) return fallbackModels(base, { showHiddenModels });

      const { settings, session } = await accountContext(auth);
      if (settings.mode === MODE_BROWSER && !session && !settings.key) {
        const err = new Error(t(lang, "errSignInExpired"));
        err.signIn = "expired";
        throw err;
      }

      try {
        const catalog = await loadCatalog(settings);
        const models = filterModels(catalog.models, {
          plan: session?.plan || settings.plan || "",
          visibleIds: catalog.visibleIds,
          showHiddenModels,
        });
        return modelsFromCatalog(models, base);
      } catch (err) {
        await log(
          "warn",
          `catalog fallback: ${err?.status ?? ""} ${err?.message ?? err}`,
        );
        const out = fallbackModels(base, { showHiddenModels });
        out[Symbol.for("magpie.fellBack")] = true;
        return out;
      }
    },
  };

  const billingCache = new Map();

  async function usageToken(settings) {
    if (settings.mode === MODE_BROWSER) {
      try {
        const info = await sessions.token({
          path: browserPath(settings),
          allowRefresh: opts.allowRefresh !== false,
        });
        return {
          token: info.token,
          email: info.email,
          plan: info.plan,
          expiresAt: info.expiresAt,
          asideAccountId: info.accountId,
        };
      } catch {
        return null;
      }
    }

    const token = settings.access || settings.key;
    if (!token) return null;
    const claims = tokenClaims(token);
    return {
      token,
      email: String(claims?.email ?? "").trim() || settings.email,
      plan: String(claims?.plan ?? "").trim() || settings.plan,
      expiresAt: settings.expires || claims?.expiresAt || 0,
      asideAccountId: settings.asideAccountId,
    };
  }

  async function usage(getAuth) {
    const auth = await getAuth();
    const settings = resolveAccountSettings(auth, opts);
    const info = await usageToken(settings);
    const key =
      info?.asideAccountId ||
      settings.asideAccountId ||
      info?.email ||
      settings.email ||
      "default";

    const cached = billingCache.get(key);
    if (cached && Date.now() - cached.at < cached.ttl) return cached.value;

    if (info?.token) {
      try {
        const billing = await fetchBilling(settings.origin, info.token, {
          fetchImpl,
          timeoutMs: BILLING_TIMEOUT_MS,
        });
        const value = buildBillingUsage({
          billing,
          email: info.email,
          expiresAt: info.expiresAt,
          lang,
        });
        billingCache.set(key, {
          at: Date.now(),
          ttl: BILLING_TTL_OK_MS,
          value,
        });
        return value;
      } catch (err) {
        await log(
          "warn",
          `billing unavailable: ${err?.status ?? ""} ${err?.message ?? err}`,
        );
      }
    }

    let value;
    if (info) {
      value = buildUsage({
        expiresAt: info.expiresAt,
        email: info.email,
        plan: info.plan,
        lang,
      });
    } else if (settings.mode === MODE_BROWSER) {
      value = buildUsageError(t(lang, "errNoToken"), lang);
    } else {
      value = buildUsage({ email: settings.email, plan: settings.plan, lang });
    }
    billingCache.set(key, { at: Date.now(), ttl: BILLING_TTL_ERR_MS, value });
    return value;
  }

  async function refresh(auth) {
    const settings = resolveAccountSettings(auth, opts);
    if (settings.mode !== MODE_GOOGLE || !settings.refresh) return {};
    const payload = await requestTokenRefresh(
      settings.origin,
      settings.refresh,
      { fetchImpl },
    );
    return {
      access: payload.accessToken,
      refresh: payload.refreshToken,
      expires: payload.expiresAt,
    };
  }

  return {
    config: async (cfg) => {
      cfg.provider ??= {};
      cfg.provider[PROVIDER] ??= {
        name: t(lang, "providerName"),
        npm: NPM_OPENAI_COMPATIBLE,
        api: apiBase(opts.baseOrigin),
        models: fallbackModels(
          {},
          { showHiddenModels: opts.showHiddenModels === true },
        ),
      };
    },

    auth: {
      provider: PROVIDER,
      methods: createMethods({ options: opts, deps: { fetchImpl, sessions } }),
      loader: async (getAuth) =>
        createLoader(getAuth, opts, { fetchImpl, sessions }),
      usage,
      refresh,
      icon: ICON_DATA_URI,
    },

    provider,

    "chat.headers": async (hookInput, output) => {
      if (hookInput?.model?.providerID !== PROVIDER) return;
      Object.assign(output.headers, sessionHeaders(hookInput?.sessionID));
    },
  };
};

export const _internal = {
  resolveOptions,
  resolveAccountSettings,
  accountIdFor,
  normalizeIncomingUrl,
  modelIdFromBody,
  baseHeaders,
  apiBase,
  fallbackModels,
  filterModels,
  modelsFromCatalog,
  normalizeCatalog,
  createMethods,
  createSessionStore,
  writeSessionBack,
  requestTokenRefresh,
  buildUsage,
  buildBillingUsage,
  normalizeBilling,
  verifyAccessToken,
  createGoogleMethod,
  findAsideApp,
  launchAside,
  waitForSession,
  compareVersions,
  describeError,
  FALLBACK_SNAPSHOT_DATE,
  ICON_DATA_URI,
  VERSION,
};
