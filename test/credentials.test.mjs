import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";

import {
  asideHome,
  credentialsPath,
  expandHome,
  parseAccounts,
  readAccounts,
  selectSession,
} from "../src/credentials.mjs";
import {
  makeAccounts,
  makeJwt,
  makeTempDir,
  writeAccountsFile,
} from "./helpers.mjs";

test("expandHome resolves the tilde prefix", () => {
  assert.equal(expandHome("~/.aside", "/home/u"), join("/home/u", ".aside"));
  assert.equal(expandHome("~", "/home/u"), "/home/u");
  assert.equal(expandHome("/opt/aside", "/home/u"), "/opt/aside");
  assert.equal(expandHome("", "/home/u"), "");
});

test("asideHome prefers ASIDE_HOME then ASIDE_HOME_PATH", () => {
  assert.equal(
    asideHome({ env: { ASIDE_HOME: "/tmp/a" }, home: "/home/u" }),
    "/tmp/a",
  );
  assert.equal(
    asideHome({ env: { ASIDE_HOME_PATH: "/tmp/b" }, home: "/home/u" }),
    "/tmp/b",
  );
  assert.equal(
    asideHome({ env: {}, home: "/home/u" }),
    join("/home/u", ".aside"),
  );
});

test("credentialsPath accepts a directory or the file itself", () => {
  assert.equal(
    credentialsPath({ explicitDir: "", env: {}, home: "/home/u" }),
    join("/home/u", ".aside", "accounts.json"),
  );
  assert.equal(
    credentialsPath({ explicitDir: "/data/aside", env: {}, home: "/home/u" }),
    join("/data/aside", "accounts.json"),
  );
  assert.equal(
    credentialsPath({
      explicitDir: "/data/aside/accounts.json",
      env: {},
      home: "/home/u",
    }),
    "/data/aside/accounts.json",
  );
});

test("selectSession follows currentAccountId", () => {
  const token = makeJwt();
  const data = makeAccounts({ accessToken: token });
  const selected = selectSession(data);
  assert.equal(selected.accountId, "0");
  assert.equal(selected.session.accessToken, token);
  assert.equal(selected.session.refreshToken, "refresh-1");
  assert.equal(selected.account.email, "user@example.com");
});

test("selectSession falls back to the first session when the current account has none", () => {
  const token = makeJwt();
  const data = makeAccounts({ accessToken: token, currentAccountId: 3 });
  data.accounts.push({
    id: 3,
    name: "Local",
    provider: "anonymous",
    mode: "local",
  });
  const selected = selectSession(data);
  assert.equal(selected.accountId, "0");
  assert.equal(selected.session.accessToken, token);
});

test("selectSession rejects files without a usable session", () => {
  assert.throws(
    () => selectSession({ accounts: [], sessions: {} }),
    /no-session/,
  );
  assert.throws(
    () => selectSession({ sessions: { 0: { accessToken: "has space" } } }),
    /invalid-token/,
  );
});

test("parseAccounts reports malformed JSON", () => {
  assert.throws(() => parseAccounts("{oops"), /bad-json/);
  assert.throws(() => parseAccounts("[]"), /bad-shape/);
});

test("readAccounts reads a real file and reports the path", () => {
  const dir = makeTempDir();
  try {
    const token = makeJwt();
    const path = writeAccountsFile(dir, makeAccounts({ accessToken: token }));
    const result = readAccounts({ explicitDir: dir });
    assert.equal(result.ok, true);
    assert.equal(result.path, path);
    assert.equal(result.session.accessToken, token);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readAccounts lists the tried path when the file is missing", () => {
  const dir = makeTempDir();
  try {
    const result = readAccounts({ explicitDir: dir });
    assert.equal(result.ok, false);
    assert.deepEqual(result.tried, [join(dir, "accounts.json")]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
