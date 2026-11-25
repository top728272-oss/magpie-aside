import {
  ACCEPT_LANGUAGE,
  API_BASE_PATH,
  BROWSER_USER_AGENT,
  DEFAULT_BASE_ORIGIN,
  HEADER_MODEL,
  HEADER_PROVIDER,
  HEADER_SESSION,
  HEADER_SIGN_IN,
  MODE_GOOGLE,
  MODE_TOKEN,
} from "./constants.mjs";
import { credentialsPath } from "./credentials.mjs";
import { resolveLang } from "./i18n.mjs";
import { resolveAccountSettings } from "./modes.mjs";
import { createSessionStore, signInError } from "./session.mjs";
import { trimSlash } from "./util.mjs";

const CHAT_SUFFIX = "/chat/completions";
const RESPONSES_SUFFIX = "/responses";
const MESSAGES_SUFFIX = "/messages";

export function apiBase(origin) {
  return `${trimSlash(origin || DEFAULT_BASE_ORIGIN)}${API_BASE_PATH}`;
}

export function baseHeaders() {
  return {
    Accept: "application/json",
    "Accept-Language": ACCEPT_LANGUAGE,
    "User-Agent": BROWSER_USER_AGENT,
    [HEADER_PROVIDER]: "true",
  };
}

export function normalizeIncomingUrl(input, settings) {
  const raw =
    typeof input === "string" ? input : (input?.url ?? String(input ?? ""));
  let pathname = "";
  let search = "";
  try {
    const url = new URL(raw);
    pathname = url.pathname;
    search = url.search;
  } catch {
    pathname = raw;
  }

  let suffix = CHAT_SUFFIX;
  if (/\/messages\/?\s*$/i.test(pathname)) suffix = MESSAGES_SUFFIX;
  else if (/\/responses\/?\s*$/i.test(pathname)) suffix = RESPONSES_SUFFIX;

  return `${apiBase(settings.origin)}${suffix}${search}`;
}

export function modelIdFromBody(body) {
  if (typeof body !== "string" || body.length === 0) return "";
  try {
    const parsed = JSON.parse(body);
    return String(parsed?.model ?? "").trim();
  } catch {
    return "";
  }
}

export async function guardResponse(res) {
  if (res.status !== 401) return res;
  const body = await res.text();
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.delete("transfer-encoding");
  headers.set(HEADER_SIGN_IN, "expired");
  return new Response(body, {
    status: res.status,
    statusText: res.statusText || "",
    headers,
  });
}

export function sessionHeaders(sessionId) {
  const value = String(sessionId ?? "").trim();
  return value ? { [HEADER_SESSION]: value } : {};
}

export function createLoader(getAuth, options = {}, deps = {}) {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const sessions = deps.sessions ?? createSessionStore({ options, deps });
  const lang = resolveLang(options);

  async function resolveToken(settings, { force = false } = {}) {
    if (settings.mode === MODE_GOOGLE) {
      if (!settings.access) throw signInError(lang);
      return settings.access;
    }
    if (settings.mode === MODE_TOKEN) {
      if (!settings.key) throw signInError(lang);
      return settings.key;
    }
    try {
      const info = await sessions.token({
        path: credentialsPath({ explicitDir: settings.dataDir }),
        force,
        allowRefresh: options.allowRefresh !== false,
      });
      return info.token;
    } catch (err) {
      if (!force && settings.key) return settings.key;
      throw err;
    }
  }

  async function send(target, init, token) {
    const headers = new Headers(init?.headers ?? {});
    for (const [name, value] of Object.entries(baseHeaders()))
      headers.set(name, value);
    headers.delete("x-api-key");
    headers.delete("api-key");
    headers.set("Authorization", `Bearer ${token}`);
    const modelId = modelIdFromBody(init?.body);
    if (modelId) headers.set(HEADER_MODEL, modelId);
    return fetchImpl(target, { ...init, headers, redirect: "error" });
  }

  return {
    baseURL: apiBase(options.baseOrigin),
    headers: baseHeaders(),
    async fetch(input, init = {}) {
      const auth = await getAuth();
      const settings = resolveAccountSettings(auth, options);
      const target = normalizeIncomingUrl(input, settings);

      let token = await resolveToken(settings, { force: false });
      let res = await send(target, init, token);

      if (res.status === 401) {
        const fresh = await resolveToken(settings, { force: true }).catch(
          () => "",
        );
        if (fresh && fresh !== token) {
          token = fresh;
          res = await send(target, init, token);
        }
      }

      return guardResponse(res);
    },
  };
}
