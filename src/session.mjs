import { readFileSync, renameSync, writeFileSync } from "node:fs";

import {
  DEFAULT_BASE_ORIGIN,
  FILE_CACHE_TTL_MS,
  REFRESH_PATH,
  REFRESH_TIMEOUT_MS,
  TOKEN_REFRESH_MARGIN_MS,
} from "./constants.mjs";
import {
  accountEmail,
  accountPlan,
  defaultIo,
  readAccounts,
} from "./credentials.mjs";
import { HttpError, fetchJson } from "./http.mjs";
import { resolveLang, t } from "./i18n.mjs";
import {
  isFresh,
  normalizePlan,
  toNumber,
  tokenClaims,
  trimSlash,
} from "./util.mjs";

const FS = {
  read: (path) => readFileSync(path, "utf8"),
  write: (path, data) => writeFileSync(path, data, "utf8"),
  rename: (from, to) => renameSync(from, to),
};

export function writeSessionBack(
  {
    path,
    accountId,
    fromAccessToken = "",
    accessToken,
    refreshToken,
    expiresAt,
  },
  fs = FS,
) {
  let data;
  try {
    data = JSON.parse(fs.read(path));
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  const key = String(accountId);
  const current = data?.sessions?.[key];
  if (!current) return { ok: false, reason: "missing-session" };
  if (
    fromAccessToken &&
    String(current.accessToken ?? "") !== fromAccessToken
  ) {
    return { ok: false, reason: "changed" };
  }
  data.sessions[key] = {
    ...current,
    accessToken,
    refreshToken: refreshToken || current.refreshToken,
    expiresAt,
  };
  const tmp = `${path}.magpie-${process.pid}.tmp`;
  try {
    fs.write(tmp, JSON.stringify(data, null, 2));
    fs.rename(tmp, path);
  } catch {
    return { ok: false, reason: "write-failed" };
  }
  return { ok: true };
}

export function signInError(
  lang = "zh",
  { path = "", reason = "", tried = [] } = {},
) {
  const message = path
    ? t(lang, "errBadCredentials", { path, reason: reason || "invalid" })
    : t(lang, "errNoCredentials", { tried: tried.join(", ") || "-" });
  const err = new Error(message);
  err.name = "SignInError";
  err.status = 401;
  err.signIn = "expired";
  return err;
}

export async function requestTokenRefresh(
  origin,
  refreshToken,
  {
    fetchImpl = globalThis.fetch,
    timeoutMs = REFRESH_TIMEOUT_MS,
    now = () => Date.now(),
  } = {},
) {
  const payload = await fetchJson(`${trimSlash(origin)}${REFRESH_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: { refreshToken },
    fetchImpl,
    timeoutMs,
  });
  const accessToken = String(payload?.accessToken ?? "").trim();
  const expiresIn = toNumber(payload?.expiresIn, 0);
  if (!accessToken || expiresIn <= 0)
    throw new Error("invalid-refresh-response");
  return {
    accessToken,
    refreshToken:
      String(payload?.refreshToken ?? "").trim() ||
      String(refreshToken ?? "").trim(),
    expiresIn,
    expiresAt: now() + expiresIn * 1000,
  };
}

export function expiredError(lang = "zh") {
  const err = new Error(t(lang, "errSignInExpired"));
  err.name = "SignInError";
  err.status = 401;
  err.signIn = "expired";
  err.code = "ACCESS_TOKEN_EXPIRED";
  return err;
}

function enrich(info) {
  const claims = tokenClaims(info.session.accessToken);
  const expiresAt =
    toNumber(info.session.expiresAt, 0) || toNumber(claims?.expiresAt, 0);
  return {
    ...info,
    token: info.session.accessToken,
    expiresAt,
    email: String(claims?.email ?? "").trim() || accountEmail(info.account),
    plan:
      normalizePlan(claims?.plan) || normalizePlan(accountPlan(info.account)),
    subject: String(claims?.subject ?? "").trim(),
  };
}

export function createSessionStore({ options = {}, deps = {} } = {}) {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const now = deps.now ?? (() => Date.now());
  const io = deps.io ?? defaultIo();
  const fs = deps.fs ?? FS;
  const onRefresh = deps.onRefresh;
  const lang = resolveLang(options);
  const cache = new Map();
  const inflight = new Map();

  function read(path, { force = false } = {}) {
    const hit = cache.get(path);
    if (hit && !force && now() - hit.at < FILE_CACHE_TTL_MS) return hit.value;
    const value = readAccounts({ explicitDir: path, io });
    cache.set(path, { at: now(), value });
    return value;
  }

  function peek(path, { force = false } = {}) {
    const info = read(path, { force });
    if (!info.ok) return info;
    return { ok: true, ...enrich(info) };
  }

  async function refresh(session) {
    const key = session.path;
    if (inflight.has(key)) return inflight.get(key);

    const task = (async () => {
      const refreshToken = String(session.session.refreshToken ?? "").trim();
      if (!refreshToken) throw expiredError(lang);

      let payload;
      try {
        payload = await requestTokenRefresh(
          options.baseOrigin || DEFAULT_BASE_ORIGIN,
          refreshToken,
          { fetchImpl, now },
        );
      } catch (err) {
        if (err instanceof HttpError && [400, 401, 403].includes(err.status))
          throw expiredError(lang);
        throw err;
      }

      const { accessToken, expiresAt } = payload;
      const nextRefresh = payload.refreshToken;
      const written = writeSessionBack(
        {
          path: session.path,
          accountId: session.accountId,
          fromAccessToken: session.token,
          accessToken,
          refreshToken: nextRefresh,
          expiresAt,
        },
        fs,
      );
      cache.delete(session.path);

      try {
        onRefresh?.({
          accountId: session.accountId,
          expiresAt,
          written,
          refreshedAt: now(),
        });
      } catch {
        void 0;
      }

      const claims = tokenClaims(accessToken);
      return {
        ...session,
        token: accessToken,
        expiresAt,
        email: String(claims?.email ?? "").trim() || session.email,
        plan: normalizePlan(claims?.plan) || session.plan,
        session: {
          ...session.session,
          accessToken,
          refreshToken: nextRefresh,
          expiresAt,
        },
        refreshed: true,
        written,
      };
    })().finally(() => inflight.delete(key));

    inflight.set(key, task);
    return task;
  }

  async function token({
    path,
    force = false,
    allowRefresh = options.allowRefresh !== false,
  } = {}) {
    const info = read(path, { force });
    if (!info.ok) throw signInError(lang, info);

    let session = enrich(info);
    if (isFresh(session.expiresAt, TOKEN_REFRESH_MARGIN_MS, now()))
      return session;

    const reread = read(path, { force: true });
    if (reread.ok) {
      const candidate = enrich(reread);
      if (isFresh(candidate.expiresAt, TOKEN_REFRESH_MARGIN_MS, now()))
        return candidate;
      session = candidate;
    }

    if (!allowRefresh) throw expiredError(lang);
    return refresh(session);
  }

  return { token, peek, refresh, clear: () => cache.clear() };
}
