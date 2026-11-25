import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { MODE_BROWSER } from "./constants.mjs";
import { credentialsPath, readAccounts } from "./credentials.mjs";
import { resolveLang, t } from "./i18n.mjs";
import { successResult, verifyAccessToken } from "./auth.mjs";
import { describeError, isFresh, tokenClaims } from "./util.mjs";

const POLL_MS = 2000;
const WAIT_MS = 5 * 60 * 1000;
const FRESH_MARGIN_MS = 120_000;

export function versionKey(value) {
  return String(value ?? "")
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map((part) => Number(part));
}

export function compareVersions(a, b) {
  const left = versionKey(a);
  const right = versionKey(b);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function findAsideApp({
  platform = process.platform,
  env = process.env,
  exists = existsSync,
  list = readdirSync,
} = {}) {
  const candidates = [];

  if (platform === "win32") {
    const roots = [
      env.ProgramFiles,
      env["ProgramFiles(x86)"],
      env.LOCALAPPDATA ? join(env.LOCALAPPDATA, "Programs") : "",
    ].filter(Boolean);

    for (const root of roots) {
      const appDir = join(root, "Aside", "Application");
      if (!exists(appDir)) continue;

      const versions = list(appDir)
        .filter((name) => /^\d+(\.\d+)+$/.test(name))
        .sort(compareVersions);
      const newest = versions[versions.length - 1] ?? "0";

      const launcher = join(appDir, "Aside.exe");
      if (exists(launcher)) candidates.push({ exe: launcher, version: newest });

      for (const version of versions) {
        const exe = join(appDir, version, "Aside.exe");
        if (exists(exe)) candidates.push({ exe, version });
      }
    }
  } else if (platform === "darwin") {
    const app = "/Applications/Aside.app";
    if (exists(app)) candidates.push({ exe: app, version: "0" });
  }

  candidates.sort((a, b) => compareVersions(b.version, a.version));
  return candidates[0] ?? null;
}

export function launchAside(app, { spawnImpl = spawn } = {}) {
  if (!app?.exe) return false;
  try {
    const child = app.exe.endsWith(".app")
      ? spawnImpl("open", ["-a", app.exe], { detached: true, stdio: "ignore" })
      : spawnImpl(app.exe, [], {
          detached: true,
          stdio: "ignore",
          windowsHide: false,
        });
    child?.unref?.();
    return true;
  } catch {
    return false;
  }
}

export function sessionState(found) {
  if (!found?.ok) return { token: "", expiresAt: 0, email: "", plan: "" };
  const claims = tokenClaims(found.session.accessToken);
  return {
    token: found.session.accessToken,
    expiresAt: found.session.expiresAt || claims?.expiresAt || 0,
    email:
      String(claims?.email ?? "").trim() ||
      String(found.account?.email ?? "").trim(),
    plan: String(claims?.plan ?? "").trim(),
  };
}

export async function waitForSession({
  path,
  baselineToken = "",
  baselineExpiresAt = 0,
  timeoutMs = WAIT_MS,
  pollMs = POLL_MS,
  signal,
  fetchImpl,
  origin,
  lang = "zh",
  now = () => Date.now(),
}) {
  const deadline = now() + timeoutMs;

  while (now() < deadline) {
    if (signal?.aborted) throw new Error("cancelled");

    const found = readAccounts({ explicitDir: path });
    if (found.ok) {
      const state = sessionState(found);
      const changed =
        state.token !== baselineToken ||
        state.expiresAt > baselineExpiresAt + 60_000;
      if (changed && isFresh(state.expiresAt, FRESH_MARGIN_MS, now())) {
        const verified = await verifyAccessToken(origin, state.token, {
          fetchImpl,
          lang,
        });
        if (verified.ok) return found;
      }
    }

    await new Promise((resolve) => {
      setTimeout(resolve, pollMs);
    });
  }

  const err = new Error(t(lang, "errGoogleTimeout"));
  err.status = 408;
  throw err;
}

export function createGoogleMethod({ options = {}, deps = {} } = {}) {
  const lang = resolveLang(options);
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const now = deps.now ?? (() => Date.now());
  const findApp = deps.findApp ?? findAsideApp;
  const launch = deps.launch ?? launchAside;
  const pollMs = deps.pollMs ?? POLL_MS;

  return {
    type: "oauth",
    label: t(lang, "loginGoogle"),
    async authorize(_inputs, { signal } = {}) {
      const path = credentialsPath({ explicitDir: options.dataDir });
      const current = readAccounts({ explicitDir: path });
      const state = sessionState(current);

      if (state.token && isFresh(state.expiresAt, FRESH_MARGIN_MS, now())) {
        const verified = await verifyAccessToken(
          options.baseOrigin,
          state.token,
          { fetchImpl, lang },
        );
        if (verified.ok) {
          return successResult({
            token: state.token,
            email: state.email,
            plan: state.plan,
            mode: MODE_BROWSER,
            dataDir: options.dataDir,
            asideAccountId: current.accountId,
          });
        }
      }

      const app = findApp();
      if (!app) return { type: "failed", error: t(lang, "errGoogleNoApp") };
      launch(app);

      return {
        url: "https://aside.com/download",
        instructions: t(lang, "googleInstructions"),
        method: "auto",
        async callback(_code, { signal: callbackSignal } = {}) {
          try {
            const found = await waitForSession({
              path,
              baselineToken: state.token,
              baselineExpiresAt: state.expiresAt,
              signal: callbackSignal ?? signal,
              fetchImpl,
              origin: options.baseOrigin,
              lang,
              now,
              pollMs,
            });
            const next = sessionState(found);
            return successResult({
              token: next.token,
              email: next.email,
              plan: next.plan,
              mode: MODE_BROWSER,
              dataDir: options.dataDir,
              asideAccountId: found.accountId,
            });
          } catch (err) {
            return { type: "failed", error: describeError(err, { lang }) };
          }
        },
      };
    },
  };
}
