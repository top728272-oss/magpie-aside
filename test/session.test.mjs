import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";

import {
  createSessionStore,
  requestTokenRefresh,
  writeSessionBack,
} from "../src/session.mjs";
import {
  makeAccounts,
  makeJwt,
  makeTempDir,
  writeAccountsFile,
  fakeFetch,
  jsonResponse,
} from "./helpers.mjs";

const NOW = 1_800_000_000_000;
const ORIGIN = "https://api.aside.com";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

test("writeSessionBack updates the session and preserves the rest of the file", () => {
  const dir = makeTempDir();
  try {
    const oldToken = makeJwt({ exp: Math.floor(NOW / 1000) + 60 });
    const path = writeAccountsFile(
      dir,
      makeAccounts({ accessToken: oldToken, expiresAt: NOW + 60_000 }),
    );
    const nextToken = makeJwt({ exp: Math.floor(NOW / 1000) + 3600 });

    const result = writeSessionBack({
      path,
      accountId: "0",
      fromAccessToken: oldToken,
      accessToken: nextToken,
      refreshToken: "refresh-2",
      expiresAt: NOW + 3600_000,
    });

    assert.equal(result.ok, true);
    const data = readJson(path);
    assert.equal(data.sessions["0"].accessToken, nextToken);
    assert.equal(data.sessions["0"].refreshToken, "refresh-2");
    assert.equal(data.sessions["0"].expiresAt, NOW + 3600_000);
    assert.equal(data.accounts.length, 1);
    assert.equal(data.currentAccountId, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writeSessionBack refuses to overwrite a session that changed underneath", () => {
  const dir = makeTempDir();
  try {
    const path = writeAccountsFile(
      dir,
      makeAccounts({ accessToken: "token-a", expiresAt: NOW + 60_000 }),
    );
    const result = writeSessionBack({
      path,
      accountId: "0",
      fromAccessToken: "token-b",
      accessToken: "token-c",
      refreshToken: "refresh-2",
      expiresAt: NOW + 3600_000,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "changed");
    assert.equal(readJson(path).sessions["0"].accessToken, "token-a");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writeSessionBack reports a missing session and an unreadable file", () => {
  const dir = makeTempDir();
  try {
    const path = writeAccountsFile(
      dir,
      makeAccounts({ accessToken: "token-a", expiresAt: NOW + 60_000 }),
    );
    assert.equal(
      writeSessionBack({ path, accountId: "9", accessToken: "x", expiresAt: 1 })
        .reason,
      "missing-session",
    );
    assert.equal(
      writeSessionBack({
        path: `${dir}/nope.json`,
        accountId: "0",
        accessToken: "x",
        expiresAt: 1,
      }).reason,
      "unreadable",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("requestTokenRefresh normalizes the gateway response", async () => {
  const fetchImpl = fakeFetch(() =>
    jsonResponse({
      accessToken: "new-token",
      refreshToken: "same-refresh",
      expiresIn: 3600,
    }),
  );
  const result = await requestTokenRefresh(ORIGIN, "same-refresh", {
    fetchImpl,
    now: () => NOW,
  });
  assert.equal(result.accessToken, "new-token");
  assert.equal(result.refreshToken, "same-refresh");
  assert.equal(result.expiresIn, 3600);
  assert.equal(result.expiresAt, NOW + 3600_000);
  assert.equal(fetchImpl.calls[0].url, `${ORIGIN}/auth/token/refresh`);
  assert.equal(
    JSON.parse(fetchImpl.calls[0].init.body).refreshToken,
    "same-refresh",
  );
});

test("requestTokenRefresh rejects a response without a token", async () => {
  const fetchImpl = fakeFetch(() => jsonResponse({ expiresIn: 3600 }));
  await assert.rejects(
    () => requestTokenRefresh(ORIGIN, "r", { fetchImpl }),
    /invalid-refresh-response/,
  );
});

test("token returns a fresh file token without calling the network", async () => {
  const dir = makeTempDir();
  try {
    const token = makeJwt({ exp: Math.floor(NOW / 1000) + 3600 });
    const path = writeAccountsFile(
      dir,
      makeAccounts({ accessToken: token, expiresAt: NOW + 3600_000 }),
    );
    const fetchImpl = fakeFetch(() => jsonResponse({}, { status: 500 }));
    const store = createSessionStore({
      options: { baseOrigin: ORIGIN },
      deps: { fetchImpl, now: () => NOW },
    });

    const info = await store.token({ path });
    assert.equal(info.token, token);
    assert.equal(info.plan, "pro");
    assert.equal(info.email, "user@example.com");
    assert.equal(fetchImpl.calls.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("token refreshes an expired file token and writes the result back", async () => {
  const dir = makeTempDir();
  try {
    const oldToken = makeJwt({ exp: Math.floor(NOW / 1000) - 60 });
    const path = writeAccountsFile(
      dir,
      makeAccounts({ accessToken: oldToken, expiresAt: NOW - 60_000 }),
    );
    const newToken = makeJwt({ exp: Math.floor(NOW / 1000) + 3600 });
    const fetchImpl = fakeFetch(() =>
      jsonResponse({
        accessToken: newToken,
        refreshToken: "refresh-1",
        expiresIn: 3600,
      }),
    );
    const store = createSessionStore({
      options: { baseOrigin: ORIGIN },
      deps: { fetchImpl, now: () => NOW },
    });

    const info = await store.token({ path });
    assert.equal(info.token, newToken);
    assert.equal(info.refreshed, true);
    assert.equal(info.written.ok, true);
    assert.equal(readJson(path).sessions["0"].accessToken, newToken);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("token reports a refresh through onRefresh", async () => {
  const dir = makeTempDir();
  try {
    const oldToken = makeJwt({ exp: Math.floor(NOW / 1000) - 60 });
    const path = writeAccountsFile(
      dir,
      makeAccounts({ accessToken: oldToken, expiresAt: NOW - 60_000 }),
    );
    const newToken = makeJwt({ exp: Math.floor(NOW / 1000) + 3600 });
    const events = [];
    const fetchImpl = fakeFetch(() =>
      jsonResponse({
        accessToken: newToken,
        refreshToken: "refresh-1",
        expiresIn: 3600,
      }),
    );
    const store = createSessionStore({
      options: { baseOrigin: ORIGIN },
      deps: {
        fetchImpl,
        now: () => NOW,
        onRefresh: (event) => events.push(event),
      },
    });

    await store.token({ path });
    assert.equal(events.length, 1);
    assert.equal(events[0].accountId, "0");
    assert.equal(events[0].expiresAt, NOW + 3600_000);
    assert.equal(events[0].written.ok, true);
    assert.equal(events[0].refreshedAt, NOW);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("token does not refresh when allowRefresh is off", async () => {
  const dir = makeTempDir();
  try {
    const oldToken = makeJwt({ exp: Math.floor(NOW / 1000) - 60 });
    const path = writeAccountsFile(
      dir,
      makeAccounts({ accessToken: oldToken, expiresAt: NOW - 60_000 }),
    );
    const fetchImpl = fakeFetch(() => jsonResponse({}, { status: 500 }));
    const store = createSessionStore({
      options: { baseOrigin: ORIGIN },
      deps: { fetchImpl, now: () => NOW },
    });

    await assert.rejects(
      () => store.token({ path, allowRefresh: false }),
      (err) => {
        assert.equal(err.signIn, "expired");
        assert.equal(err.code, "ACCESS_TOKEN_EXPIRED");
        return true;
      },
    );
    assert.equal(fetchImpl.calls.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("token throws a sign-in error when the account file is missing", async () => {
  const dir = makeTempDir();
  try {
    const store = createSessionStore({
      options: { baseOrigin: ORIGIN },
      deps: { fetchImpl: fakeFetch(() => jsonResponse({})), now: () => NOW },
    });
    await assert.rejects(
      () => store.token({ path: `${dir}/accounts.json` }),
      (err) => {
        assert.equal(err.signIn, "expired");
        assert.match(err.message, /accounts\.json/);
        return true;
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("concurrent token calls share one refresh", async () => {
  const dir = makeTempDir();
  try {
    const oldToken = makeJwt({ exp: Math.floor(NOW / 1000) - 60 });
    const path = writeAccountsFile(
      dir,
      makeAccounts({ accessToken: oldToken, expiresAt: NOW - 60_000 }),
    );
    const newToken = makeJwt({ exp: Math.floor(NOW / 1000) + 3600 });
    const fetchImpl = fakeFetch(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return jsonResponse({
        accessToken: newToken,
        refreshToken: "refresh-1",
        expiresIn: 3600,
      });
    });
    const store = createSessionStore({
      options: { baseOrigin: ORIGIN },
      deps: { fetchImpl, now: () => NOW },
    });

    const [a, b] = await Promise.all([
      store.token({ path }),
      store.token({ path }),
    ]);
    assert.equal(a.token, newToken);
    assert.equal(b.token, newToken);
    assert.equal(fetchImpl.calls.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("peek reports the account without refreshing", () => {
  const dir = makeTempDir();
  try {
    const oldToken = makeJwt({ exp: Math.floor(NOW / 1000) - 60 });
    const path = writeAccountsFile(
      dir,
      makeAccounts({ accessToken: oldToken, expiresAt: NOW - 60_000 }),
    );
    const fetchImpl = fakeFetch(() => jsonResponse({}, { status: 500 }));
    const store = createSessionStore({
      options: { baseOrigin: ORIGIN },
      deps: { fetchImpl, now: () => NOW },
    });

    const info = store.peek(path);
    assert.equal(info.ok, true);
    assert.equal(info.expiresAt, NOW - 60_000);
    assert.equal(fetchImpl.calls.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
