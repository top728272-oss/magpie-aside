import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBillingUsage,
  buildUsage,
  buildUsageError,
} from "../src/usage.mjs";
import { normalizeBilling } from "../src/billing.mjs";

const NOW = 1_800_000_000_000;

const BILLING = normalizeBilling({
  subscription: {
    plan: { slug: "pro", name: "Pro", tier: 1 },
    status: "active",
    interval: "month",
    currentPeriodStart: "2026-11-24T22:19:10.000Z",
    currentPeriodEnd: "2026-12-24T22:19:10.000Z",
    cancelAtPeriodEnd: false,
  },
  credit: {
    add_on_balance_micros: "0",
    balance_micros: "17990498",
    credit_micros_per_usd: 1000000,
    monthly_grant_micros: "18000000",
    remaining_percent: 99,
    used_percent: 1,
    refresh_at: "2026-12-24T22:19:10.000Z",
  },
});

test("buildUsage shows the plan, the account and the session window", () => {
  const usage = buildUsage({
    expiresAt: NOW + 3600_000,
    email: "user@example.com",
    plan: "pro",
    lang: "en",
    now: NOW,
  });

  assert.equal(usage.plan, "Pro");
  assert.equal(usage.user, "user@example.com");
  assert.equal(usage.windows.length, 1);
  assert.equal(usage.windows[0].aside, true);
  assert.equal(usage.windows[0].display, "Access token valid for 1h 0m");
  assert.equal(
    usage.windows[0].resetsAt,
    new Date(NOW + 3600_000).toISOString(),
  );
  assert.equal(usage.windows[0].used, undefined);
  assert.equal(usage.windows[0].limit, undefined);
});

test("buildUsage marks an expired session", () => {
  const usage = buildUsage({
    expiresAt: NOW - 1000,
    plan: "free",
    lang: "en",
    now: NOW,
  });
  assert.equal(usage.plan, "Free");
  assert.equal(usage.windows[0].display, "Access token expired");
});

test("buildUsage reports a missing session without inventing numbers", () => {
  const usage = buildUsage({ lang: "en", now: NOW });
  assert.equal(usage.windows[0].display, "No account session was read");
  assert.equal(usage.plan, undefined);
  assert.equal(usage.user, undefined);
});

test("buildUsage localizes durations", () => {
  const usage = buildUsage({ expiresAt: NOW + 90_000, lang: "zh", now: NOW });
  assert.equal(usage.windows[0].display, "访问令牌剩余 1 分钟");
});

test("buildBillingUsage shows the real monthly credit", () => {
  const usage = buildBillingUsage({
    billing: BILLING,
    email: "user@example.com",
    lang: "en",
  });
  assert.equal(usage.plan, "Pro");
  assert.equal(usage.user, "user@example.com");
  assert.equal(usage.until, "2026-12-24T22:19:10.000Z");
  assert.equal(usage.renew, "auto");
  assert.equal(usage.balance, "$17.99");
  assert.equal(usage.windows.length, 1);
  assert.equal(usage.windows[0].name, "Monthly credit");
  assert.equal(usage.windows[0].unit, "USD");
  assert.equal(usage.windows[0].used, 1);
  assert.equal(usage.windows[0].display, "$17.99 / $18.00 left");
  assert.equal(usage.windows[0].resetsAt, "2026-12-24T22:19:10.000Z");
  assert.equal(usage.windows[0].span, 2592000);
});

test("buildBillingUsage keeps the token expiry meter", () => {
  const usage = buildBillingUsage({
    billing: BILLING,
    expiresAt: NOW + 3600_000,
    lang: "en",
    now: NOW,
  });
  assert.equal(usage.windows.length, 2);
  assert.equal(usage.windows[0].unit, "USD");
  assert.equal(usage.windows[1].name, "Aside session");
  assert.equal(usage.windows[1].display, "Access token valid for 1h 0m");
  assert.equal(usage.windows[1].aside, true);
  assert.equal(
    usage.windows[1].resetsAt,
    new Date(NOW + 3600_000).toISOString(),
  );
});

test("buildBillingUsage marks an expired token next to the credit", () => {
  const usage = buildBillingUsage({
    billing: BILLING,
    expiresAt: NOW - 1000,
    lang: "en",
    now: NOW,
  });
  assert.equal(usage.windows.length, 2);
  assert.equal(usage.windows[1].display, "Access token expired");
});

test("buildBillingUsage adds an add-on window when credits exist", () => {
  const usage = buildBillingUsage({
    billing: { ...BILLING, addOn: 5 },
    lang: "en",
  });
  assert.equal(usage.windows.length, 2);
  assert.equal(usage.windows[1].name, "Add-on credit");
  assert.equal(usage.windows[1].balance, 5);
  assert.equal(usage.windows[1].aside, true);
});

test("buildBillingUsage localizes the display and marks a cancelled plan", () => {
  const usage = buildBillingUsage({
    billing: { ...BILLING, cancelAtPeriodEnd: true },
    lang: "zh",
  });
  assert.equal(usage.renew, "off");
  assert.equal(usage.windows[0].name, "本月额度");
  assert.equal(usage.windows[0].display, "剩 $17.99 / $18.00");
});

test("buildUsageError keeps the vendor message", () => {
  const usage = buildUsageError("token gone", "en");
  assert.equal(usage.error, "token gone");
  assert.deepEqual(usage.windows, []);
});
