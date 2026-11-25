import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function b64url(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function makeJwt({
  exp = Math.floor(Date.now() / 1000) + 3600,
  email = "user@example.com",
  plan = "pro",
  sub = "user-1",
  type = "access",
} = {}) {
  const header = b64url({ alg: "none", typ: "JWT" });
  const payload = b64url({
    exp,
    email,
    plan,
    sub,
    iss: "aside.app",
    aud: "aside-api",
    type,
  });
  return `${header}.${payload}.signature`;
}

export function makeAccounts({
  accessToken,
  refreshToken = "refresh-1",
  expiresAt = Date.now() + 3600_000,
  currentAccountId = 0,
  plan = "pro",
  email = "user@example.com",
} = {}) {
  return {
    version: 1,
    currentAccountId,
    accounts: [
      {
        id: 0,
        name: "User",
        provider: "google",
        mode: "cloud",
        authStatus: "active",
        email,
        subscriptionPlan: plan,
      },
    ],
    sessions: {
      0: { accessToken, refreshToken, expiresAt },
    },
  };
}

export function writeAccountsFile(dir, data) {
  const path = join(dir, "accounts.json");
  writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
  return path;
}

export function makeTempDir() {
  return mkdtempSync(join(tmpdir(), "magpie-aside-"));
}

export function fakeFetch(handler) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init, calls.length);
  };
  impl.calls = calls;
  return impl;
}

export function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}
