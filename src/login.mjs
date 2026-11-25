import { MODE_BROWSER, MODE_TOKEN } from "./constants.mjs";
import { credentialsPath } from "./credentials.mjs";
import { resolveLang, t } from "./i18n.mjs";
import { successResult, verifyAccessToken } from "./auth.mjs";
import { createGoogleMethod } from "./google.mjs";
import { describeError, tokenClaims } from "./util.mjs";

export { successResult, verifyAccessToken };

export function pickKey(inputs) {
  for (const name of [
    "key",
    "apiKey",
    "token",
    "secret",
    "api_key",
    "accessToken",
  ]) {
    const value = inputs?.[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function inputShape(inputs) {
  const names = Object.entries(inputs ?? {})
    .filter(
      ([, value]) =>
        value !== undefined && value !== null && String(value).trim() !== "",
    )
    .map(([name]) => name);
  return names.length > 0
    ? `fields present: ${names.join(", ")}`
    : "no input fields";
}

function pasteMethod({ options, lang, fetchImpl }) {
  return {
    type: "api",
    label: t(lang, "loginPaste"),
    placeholder: "eyJhbGciOi...",
    prompts: [
      { type: "password", key: "key", message: t(lang, "promptAccessToken") },
      { type: "text", key: "email", message: t(lang, "promptEmail") },
    ],
    async authorize(inputs = {}) {
      if (options.debug)
        console.error(`[magpie-aside] paste ${inputShape(inputs)}`);
      const token = pickKey(inputs);
      if (!token) return { type: "failed", error: t(lang, "errKeyMissing") };

      const verified = await verifyAccessToken(options.baseOrigin, token, {
        fetchImpl,
        lang,
      });
      if (!verified.ok) return { type: "failed", error: verified.error };

      const claims = tokenClaims(token);
      const email =
        String(inputs?.email ?? "").trim() ||
        String(claims?.email ?? "").trim();
      return successResult({
        token,
        email,
        plan: String(claims?.plan ?? "").trim(),
        mode: MODE_TOKEN,
      });
    },
  };
}

function browserMethod({ options, lang, fetchImpl, sessions }) {
  return {
    type: "api",
    label: t(lang, "loginBrowser"),
    placeholder: "auto",
    prompts: [
      {
        type: "text",
        key: "dir",
        message: t(lang, "promptDataDir"),
        placeholder: "~/.aside",
      },
      {
        type: "password",
        key: "key",
        message: t(lang, "promptBrowserKey"),
        placeholder: "auto",
      },
    ],
    async authorize(inputs = {}) {
      if (options.debug)
        console.error(`[magpie-aside] browser ${inputShape(inputs)}`);

      const dir = String(inputs?.dir ?? "").trim();
      const typedRaw = pickKey(inputs);
      const typed = /^(auto|read|读取)$/i.test(typedRaw) ? "" : typedRaw;

      if (typed) {
        const verified = await verifyAccessToken(options.baseOrigin, typed, {
          fetchImpl,
          lang,
        });
        if (!verified.ok) return { type: "failed", error: verified.error };
        const claims = tokenClaims(typed);
        return successResult({
          token: typed,
          email: String(claims?.email ?? "").trim(),
          plan: String(claims?.plan ?? "").trim(),
          mode: MODE_TOKEN,
        });
      }

      const path = credentialsPath({ explicitDir: dir || options.dataDir });
      let info;
      try {
        info = await sessions.token({
          path,
          force: true,
          allowRefresh: options.allowRefresh !== false,
        });
      } catch (err) {
        return { type: "failed", error: describeError(err, { lang }) };
      }

      const verified = await verifyAccessToken(options.baseOrigin, info.token, {
        fetchImpl,
        lang,
      });
      if (!verified.ok) return { type: "failed", error: verified.error };

      return successResult({
        token: info.token,
        email: info.email,
        plan: info.plan,
        mode: MODE_BROWSER,
        dataDir: dir || options.dataDir,
        asideAccountId: info.accountId,
      });
    },
  };
}

export function createMethods({ options = {}, deps = {} } = {}) {
  const lang = resolveLang(options);
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const sessions = deps.sessions;
  return [
    createGoogleMethod({ options, deps: { fetchImpl, now: deps.now } }),
    browserMethod({ options, lang, fetchImpl, sessions }),
    pasteMethod({ options, lang, fetchImpl }),
  ];
}
