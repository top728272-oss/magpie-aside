import { DEFAULT_BASE_ORIGIN } from "./constants.mjs";
import { baseHeaders } from "./fetch.mjs";
import { fetchJson } from "./http.mjs";
import { toNumber, trimSlash } from "./util.mjs";

const MICROS_PER_USD = 1_000_000;

export function microsToUsd(value) {
  return toNumber(value, 0) / MICROS_PER_USD;
}

export function formatUsd(value) {
  return `$${toNumber(value, 0).toFixed(2)}`;
}

export function periodSpanSeconds(start, end) {
  const from = Date.parse(String(start ?? ""));
  const to = Date.parse(String(end ?? ""));
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 0;
  return Math.round((to - from) / 1000);
}

export function normalizeBilling(payload = {}) {
  const subscription = payload?.subscription ?? {};
  const plan = subscription?.plan ?? {};
  const credit = payload?.credit ?? {};

  return {
    planSlug: String(plan?.slug ?? "").trim(),
    planName: String(plan?.name ?? plan?.slug ?? "").trim(),
    status: String(subscription?.status ?? "").trim(),
    interval: String(subscription?.interval ?? "").trim(),
    periodStart: String(subscription?.currentPeriodStart ?? "").trim(),
    periodEnd: String(subscription?.currentPeriodEnd ?? "").trim(),
    cancelAtPeriodEnd: Boolean(subscription?.cancelAtPeriodEnd),
    grant: microsToUsd(credit?.monthly_grant_micros),
    balance: microsToUsd(credit?.balance_micros),
    addOn: microsToUsd(credit?.add_on_balance_micros),
    usedPercent: toNumber(credit?.used_percent, 0),
    remainingPercent: toNumber(credit?.remaining_percent, 0),
    refreshAt: String(credit?.refresh_at ?? "").trim(),
  };
}

export async function fetchBilling(
  origin,
  token,
  { fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {},
) {
  const payload = await fetchJson(
    `${trimSlash(origin || DEFAULT_BASE_ORIGIN)}/billing/subscription`,
    {
      headers: { ...baseHeaders(), Authorization: `Bearer ${token}` },
      fetchImpl,
      timeoutMs,
    },
  );
  return normalizeBilling(payload);
}
