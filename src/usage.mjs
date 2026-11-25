import { formatUsd, periodSpanSeconds } from "./billing.mjs";
import { t } from "./i18n.mjs";
import { formatDuration, planLabel, toNumber } from "./util.mjs";

export function sessionWindow({
  expiresAt = 0,
  lang = "zh",
  now = Date.now(),
} = {}) {
  const at = toNumber(expiresAt, 0);
  if (at <= 0) {
    return {
      name: t(lang, "usageSessionName"),
      aside: true,
      display: t(lang, "usageNoSession"),
    };
  }

  const left = at - now;
  return {
    name: t(lang, "usageSessionName"),
    aside: true,
    display:
      left > 0
        ? t(lang, "usageSessionLeft", { time: formatDuration(left, lang) })
        : t(lang, "usageSessionExpired"),
    resetsAt: new Date(at).toISOString(),
  };
}

export function buildBillingUsage({
  billing = null,
  email = "",
  expiresAt = 0,
  lang = "zh",
  now = Date.now(),
} = {}) {
  const usage = { windows: [] };
  if (billing?.planName) usage.plan = billing.planName;
  if (email) usage.user = email;
  if (billing?.periodEnd) usage.until = billing.periodEnd;
  if (billing) usage.renew = billing.cancelAtPeriodEnd ? "off" : "auto";
  if (billing?.balance !== undefined)
    usage.balance = formatUsd(billing.balance);

  const window = {
    name: t(lang, "usageCreditName"),
    unit: "USD",
    used: toNumber(billing?.usedPercent, 0),
    display: t(lang, "usageCreditDisplay", {
      balance: formatUsd(billing?.balance),
      grant: formatUsd(billing?.grant),
    }),
  };
  if (billing?.refreshAt) window.resetsAt = billing.refreshAt;
  const span = periodSpanSeconds(billing?.periodStart, billing?.periodEnd);
  if (span > 0) window.span = span;
  usage.windows.push(window);

  if (toNumber(billing?.addOn, 0) > 0) {
    usage.windows.push({
      name: t(lang, "usageAddOnName"),
      unit: "USD",
      balance: toNumber(billing.addOn, 0),
      display: formatUsd(billing.addOn),
      aside: true,
    });
  }

  if (toNumber(expiresAt, 0) > 0)
    usage.windows.push(sessionWindow({ expiresAt, lang, now }));

  return usage;
}

export function buildUsage({
  expiresAt = 0,
  email = "",
  plan = "",
  lang = "zh",
  now = Date.now(),
} = {}) {
  const usage = { windows: [] };
  const label = planLabel(plan);
  if (label) usage.plan = label;
  if (email) usage.user = email;
  usage.windows.push(sessionWindow({ expiresAt, lang, now }));
  return usage;
}

export function buildUsageError(message, lang = "zh") {
  return {
    error: String(message ?? "").trim() || t(lang, "errSignInExpired"),
    windows: [],
  };
}
