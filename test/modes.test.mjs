import test from "node:test";
import assert from "node:assert/strict";

import { accountIdFor, resolveAccountSettings } from "../src/modes.mjs";

test("resolveAccountSettings prefers login metadata over plugin options", () => {
  const settings = resolveAccountSettings(
    {
      type: "api",
      key: "tok",
      metadata: {
        mode: "browser",
        dataDir: "/data/aside",
        email: "a@b.c",
        plan: "pro",
        asideAccountId: "0",
      },
    },
    { baseOrigin: "https://api.aside.com/", dataDir: "/ignored" },
  );

  assert.equal(settings.mode, "browser");
  assert.equal(settings.origin, "https://api.aside.com");
  assert.equal(settings.dataDir, "/data/aside");
  assert.equal(settings.key, "tok");
  assert.equal(settings.email, "a@b.c");
  assert.equal(settings.plan, "pro");
  assert.equal(settings.asideAccountId, "0");
});

test("resolveAccountSettings treats an oauth account as Google mode", () => {
  const settings = resolveAccountSettings(
    { type: "oauth", access: "a", refresh: "r", expires: 123 },
    {},
  );
  assert.equal(settings.mode, "google");
  assert.equal(settings.access, "a");
  assert.equal(settings.refresh, "r");
  assert.equal(settings.expires, 123);
});

test("accountIdFor is stable per Aside account and per email", () => {
  assert.equal(accountIdFor({ asideAccountId: "0" }), "aside:0");
  assert.equal(
    accountIdFor({ email: "User@Example.com" }),
    accountIdFor({ email: "user@example.com" }),
  );
  assert.match(
    accountIdFor({ email: "user@example.com" }),
    /^aside:[0-9a-f]{12}$/,
  );
  assert.match(accountIdFor({ token: "abc" }), /^aside:[0-9a-f]{12}$/);
  assert.equal(accountIdFor({}), "aside:local");
});
