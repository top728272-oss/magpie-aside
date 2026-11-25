import test from "node:test";
import assert from "node:assert/strict";

import {
  fetchBilling,
  formatUsd,
  microsToUsd,
  normalizeBilling,
  periodSpanSeconds,
} from "../src/billing.mjs";
import { fakeFetch, jsonResponse } from "./helpers.mjs";

const ORIGIN = "https://api.aside.com";

const PAYLOAD = {
  joined_at: "2026-11-24T22:16:32.892663+00:00",
  subscription: {
    plan: { slug: "pro", name: "Pro", tier: 1 },
    status: "active",
    interval: "month",
    currentPeriodStart: "2026-11-24T22:19:10.000Z",
    currentPeriodEnd: "2026-12-24T22:19:10.000Z",
    cancelAtPeriodEnd: false,
    features: ["ai_assistant", "memory"],
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
  paymentMethod: null,
  invoices: [],
};

test("microsToUsd converts the gateway's micro-dollar strings", () => {
  assert.equal(microsToUsd("17990498"), 17.990498);
  assert.equal(microsToUsd("18000000"), 18);
  assert.equal(microsToUsd("0"), 0);
  assert.equal(microsToUsd(undefined), 0);
});

test("formatUsd renders two decimals", () => {
  assert.equal(formatUsd(17.990498), "$17.99");
  assert.equal(formatUsd(18), "$18.00");
  assert.equal(formatUsd(0.004), "$0.00");
});

test("periodSpanSeconds reads ISO periods", () => {
  assert.equal(
    periodSpanSeconds("2026-11-24T22:19:10.000Z", "2026-12-24T22:19:10.000Z"),
    30 * 24 * 3600,
  );
  assert.equal(periodSpanSeconds("", "2026-12-24T22:19:10.000Z"), 0);
  assert.equal(
    periodSpanSeconds("2026-12-24T22:19:10.000Z", "2026-11-24T22:19:10.000Z"),
    0,
  );
});

test("normalizeBilling flattens the subscription response", () => {
  const billing = normalizeBilling(PAYLOAD);
  assert.equal(billing.planSlug, "pro");
  assert.equal(billing.planName, "Pro");
  assert.equal(billing.status, "active");
  assert.equal(billing.interval, "month");
  assert.equal(billing.periodEnd, "2026-12-24T22:19:10.000Z");
  assert.equal(billing.cancelAtPeriodEnd, false);
  assert.equal(billing.grant, 18);
  assert.equal(billing.balance, 17.990498);
  assert.equal(billing.addOn, 0);
  assert.equal(billing.usedPercent, 1);
  assert.equal(billing.remainingPercent, 99);
  assert.equal(billing.refreshAt, "2026-12-24T22:19:10.000Z");
});

test("normalizeBilling tolerates a missing subscription", () => {
  const billing = normalizeBilling({});
  assert.equal(billing.planName, "");
  assert.equal(billing.balance, 0);
  assert.equal(billing.grant, 0);
  assert.equal(billing.usedPercent, 0);
});

test("fetchBilling calls /billing/subscription with the account token", async () => {
  const fetchImpl = fakeFetch(() => jsonResponse(PAYLOAD));
  const billing = await fetchBilling(ORIGIN, "test-token", { fetchImpl });
  assert.equal(billing.planName, "Pro");
  assert.equal(billing.balance, 17.990498);

  const call = fetchImpl.calls[0];
  const headers = new Headers(call.init.headers);
  assert.equal(call.url, `${ORIGIN}/billing/subscription`);
  assert.equal(headers.get("authorization"), "Bearer test-token");
  assert.match(headers.get("user-agent"), /Mozilla\/5\.0/);
});
