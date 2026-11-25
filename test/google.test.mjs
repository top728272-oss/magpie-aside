import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";

import {
  compareVersions,
  createGoogleMethod,
  findAsideApp,
  launchAside,
  sessionState,
  waitForSession,
} from "../src/google.mjs";
import {
  fakeFetch,
  jsonResponse,
  makeAccounts,
  makeJwt,
  makeTempDir,
  writeAccountsFile,
} from "./helpers.mjs";

const ORIGIN = "https://api.aside.com";
const nowSec = () => Math.floor(Date.now() / 1000);

test("compareVersions orders numeric segments, not strings", () => {
  assert.ok(compareVersions("1.0.1116.2", "1.0.999.9") > 0);
  assert.ok(compareVersions("1.0.9", "1.0.10") < 0);
  assert.equal(compareVersions("1.0.1116.2", "1.0.1116.2"), 0);
});

test("findAsideApp picks the newest installed version", () => {
  const app = findAsideApp({
    platform: "win32",
    env: { ProgramFiles: "C:\\PF" },
    exists: (path) =>
      path === join("C:\\PF", "Aside", "Application") ||
      path.endsWith("Aside.exe"),
    list: () => ["1.0.9", "1.0.1116.2", "1.0.1000.1", "SetupMetrics"],
  });
  assert.equal(app.version, "1.0.1116.2");
  assert.equal(app.exe, join("C:\\PF", "Aside", "Application", "Aside.exe"));
});

test("findAsideApp returns null when nothing is installed", () => {
  assert.equal(
    findAsideApp({
      platform: "win32",
      env: { ProgramFiles: "C:\\PF" },
      exists: () => false,
    }),
    null,
  );
  assert.equal(findAsideApp({ platform: "linux", env: {} }), null);
});

test("launchAside spawns the app detached and releases it", () => {
  let called = null;
  let unrefed = false;
  const spawnImpl = (exe, args, opts) => {
    called = { exe, args, opts };
    return {
      unref: () => {
        unrefed = true;
      },
    };
  };

  const ok = launchAside({ exe: "C:\\PF\\Aside.exe" }, { spawnImpl });
  assert.equal(ok, true);
  assert.equal(called.exe, "C:\\PF\\Aside.exe");
  assert.equal(called.opts.detached, true);
  assert.equal(called.opts.stdio, "ignore");
  assert.equal(unrefed, true);
});

test("sessionState falls back to the account record when the token has no claims", () => {
  const state = sessionState({
    ok: true,
    session: { accessToken: "opaque", expiresAt: 42 },
    account: { email: "a@b.c" },
  });
  assert.equal(state.token, "opaque");
  assert.equal(state.expiresAt, 42);
  assert.equal(state.email, "a@b.c");
  assert.deepEqual(sessionState({ ok: false }), {
    token: "",
    expiresAt: 0,
    email: "",
    plan: "",
  });
});

test("waitForSession returns as soon as a new valid session appears", async () => {
  const dir = makeTempDir();
  try {
    const oldToken = makeJwt({ exp: nowSec() + 3600 });
    const path = writeAccountsFile(
      dir,
      makeAccounts({ accessToken: oldToken, expiresAt: Date.now() + 3600_000 }),
    );
    const newToken = makeJwt({
      exp: nowSec() + 7200,
      email: "next@example.com",
    });
    const fetchImpl = fakeFetch(() => jsonResponse({ ok: true }));

    setTimeout(() => {
      writeAccountsFile(
        dir,
        makeAccounts({
          accessToken: newToken,
          expiresAt: Date.now() + 7200_000,
        }),
      );
    }, 20);

    const found = await waitForSession({
      path,
      baselineToken: oldToken,
      baselineExpiresAt: Date.now() + 3600_000,
      timeoutMs: 2000,
      pollMs: 10,
      fetchImpl,
      origin: ORIGIN,
      lang: "en",
    });

    assert.equal(found.ok, true);
    assert.equal(found.session.accessToken, newToken);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("waitForSession times out when the session never changes", async () => {
  const dir = makeTempDir();
  try {
    const token = makeJwt({ exp: nowSec() + 3600 });
    const path = writeAccountsFile(
      dir,
      makeAccounts({ accessToken: token, expiresAt: Date.now() + 3600_000 }),
    );
    await assert.rejects(
      () =>
        waitForSession({
          path,
          baselineToken: token,
          baselineExpiresAt: Date.now() + 3600_000,
          timeoutMs: 40,
          pollMs: 10,
          fetchImpl: fakeFetch(() => jsonResponse({})),
          origin: ORIGIN,
          lang: "en",
        }),
      /Timed out waiting for the Aside sign-in/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("google method signs in immediately when a fresh session already exists", async () => {
  const dir = makeTempDir();
  try {
    const token = makeJwt({ exp: nowSec() + 3600 });
    writeAccountsFile(
      dir,
      makeAccounts({ accessToken: token, expiresAt: Date.now() + 3600_000 }),
    );
    const method = createGoogleMethod({
      options: { baseOrigin: ORIGIN, dataDir: dir },
      deps: {
        fetchImpl: fakeFetch(() => jsonResponse({ ok: true })),
        findApp: () => null,
        launch: () => false,
      },
    });

    const result = await method.authorize({}, {});
    assert.equal(result.type, "success");
    assert.equal(result.key, token);
    assert.equal(result.metadata.mode, "browser");
    assert.equal(result.accountId, "aside:0");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("google method fails clearly when Aside is not installed", async () => {
  const dir = makeTempDir();
  try {
    const method = createGoogleMethod({
      options: { baseOrigin: ORIGIN, dataDir: dir, lang: "en" },
      deps: {
        fetchImpl: fakeFetch(() => jsonResponse({})),
        findApp: () => null,
        launch: () => false,
      },
    });
    const result = await method.authorize({}, {});
    assert.equal(result.type, "failed");
    assert.match(result.error, /Aside app was not found/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("google method launches Aside and adopts the session it creates", async () => {
  const dir = makeTempDir();
  try {
    const oldToken = makeJwt({ exp: nowSec() - 60 });
    const path = writeAccountsFile(
      dir,
      makeAccounts({ accessToken: oldToken, expiresAt: Date.now() - 60_000 }),
    );
    const newToken = makeJwt({ exp: nowSec() + 3600 });
    let launched = 0;

    const method = createGoogleMethod({
      options: { baseOrigin: ORIGIN, dataDir: dir, lang: "en" },
      deps: {
        fetchImpl: fakeFetch(() => jsonResponse({ ok: true })),
        findApp: () => ({ exe: "C:\\PF\\Aside.exe", version: "1.0.0" }),
        launch: () => {
          launched += 1;
          return true;
        },
        pollMs: 10,
      },
    });

    const flow = await method.authorize({}, {});
    assert.equal(flow.type, undefined);
    assert.equal(flow.url, "https://aside.com/download");
    assert.equal(flow.method, "auto");
    assert.equal(launched, 1);

    writeAccountsFile(
      dir,
      makeAccounts({ accessToken: newToken, expiresAt: Date.now() + 3600_000 }),
    );
    const result = await flow.callback();
    assert.equal(result.type, "success");
    assert.equal(result.key, newToken);
    assert.equal(result.metadata.mode, "browser");
    assert.equal(result.accountId, "aside:0");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
