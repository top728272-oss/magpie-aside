import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  CREDENTIALS_FILE,
  DEFAULT_HOME_DIR,
  HOME_ENV_NAMES,
} from "./constants.mjs";
import { toNumber } from "./util.mjs";

function nonEmpty(value) {
  return typeof value === "string" && value.trim() !== "";
}

export function expandHome(value, home = homedir()) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw === "~") return home;
  if (raw.startsWith("~/") || raw.startsWith("~\\"))
    return join(home, raw.slice(2));
  return raw;
}

export function asideHome({ env = process.env, home = homedir() } = {}) {
  for (const name of HOME_ENV_NAMES) {
    const value = String(env?.[name] ?? "").trim();
    if (value) return expandHome(value, home);
  }
  return join(home, DEFAULT_HOME_DIR);
}

export function credentialsPath({
  explicitDir = "",
  env = process.env,
  home = homedir(),
} = {}) {
  const raw = expandHome(explicitDir, home);
  if (!raw) return join(asideHome({ env, home }), CREDENTIALS_FILE);
  if (raw.toLowerCase().endsWith(CREDENTIALS_FILE.toLowerCase())) return raw;
  return join(raw, CREDENTIALS_FILE);
}

export function defaultIo() {
  return {
    exists: (path) => existsSync(path),
    isFile: (path) => {
      try {
        return statSync(path).isFile();
      } catch {
        return false;
      }
    },
    read: (path) => readFileSync(path, "utf8"),
  };
}

export function selectSession(data) {
  const accounts = Array.isArray(data?.accounts) ? data.accounts : [];
  const sessions =
    data?.sessions && typeof data.sessions === "object" ? data.sessions : {};
  const currentId = String(data?.currentAccountId ?? "").trim();

  let key =
    currentId && String(sessions[currentId]?.accessToken ?? "").trim()
      ? currentId
      : "";
  if (!key) {
    key =
      Object.keys(sessions).find((name) =>
        String(sessions[name]?.accessToken ?? "").trim(),
      ) ?? "";
  }
  if (!key) throw new Error("no-session");

  const session = sessions[key] ?? {};
  const accessToken = String(session.accessToken ?? "").trim();
  if (!accessToken) throw new Error("no-session");
  if (/\s/.test(accessToken) || accessToken.length > 8192)
    throw new Error("invalid-token");

  const account =
    accounts.find((item) => String(item?.id ?? "") === key) ?? null;
  return {
    accountId: key,
    account,
    session: {
      accessToken,
      refreshToken: String(session.refreshToken ?? "").trim(),
      expiresAt: toNumber(session.expiresAt, 0),
    },
    accountsCount: accounts.length,
  };
}

export function parseAccounts(raw, path = "") {
  let data;
  try {
    data = JSON.parse(String(raw ?? ""));
  } catch (err) {
    throw new Error(`bad-json: ${err?.message ?? "invalid JSON"}`);
  }
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error("bad-shape");
  return { path, ...selectSession(data) };
}

export function readAccounts({
  explicitDir = "",
  env = process.env,
  home = homedir(),
  io = defaultIo(),
} = {}) {
  const path = credentialsPath({ explicitDir, env, home });
  const tried = [path];
  if (!io.isFile(path)) return { ok: false, tried };
  try {
    return { ok: true, ...parseAccounts(io.read(path), path) };
  } catch (err) {
    return { ok: false, tried, path, reason: String(err?.message ?? err) };
  }
}

export function accountEmail(account) {
  if (!account || typeof account !== "object") return "";
  return String(account.email ?? account.name ?? "").trim();
}

export function accountPlan(account) {
  if (!account || typeof account !== "object") return "";
  return String(account.subscriptionPlan ?? "").trim();
}

export { nonEmpty };
