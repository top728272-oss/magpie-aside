import { DEFAULT_BASE_ORIGIN, MODE_GOOGLE, MODE_TOKEN } from "./constants.mjs";
import { normalizePlan, sha256Hex, toNumber, trimSlash } from "./util.mjs";

export function resolveAccountSettings(auth, options = {}) {
  const metadata = auth?.metadata ?? {};
  const mode =
    String(
      metadata.mode ?? (auth?.type === "oauth" ? MODE_GOOGLE : MODE_TOKEN),
    ).trim() || MODE_TOKEN;

  return {
    mode,
    origin: trimSlash(options.baseOrigin || DEFAULT_BASE_ORIGIN),
    dataDir: String(metadata.dataDir ?? options.dataDir ?? "").trim(),
    access: String(auth?.access ?? "").trim(),
    key: String(auth?.key ?? "").trim(),
    refresh: String(auth?.refresh ?? "").trim(),
    expires: toNumber(auth?.expires, 0),
    email: String(metadata.email ?? "").trim(),
    plan: normalizePlan(metadata.plan),
    asideAccountId: String(metadata.asideAccountId ?? "").trim(),
  };
}

export function accountIdFor({
  asideAccountId = "",
  email = "",
  token = "",
} = {}) {
  const id = String(asideAccountId ?? "").trim();
  if (id) return `aside:${id}`;
  const mail = String(email ?? "")
    .trim()
    .toLowerCase();
  if (mail) return `aside:${sha256Hex(mail).slice(0, 12)}`;
  const raw = String(token ?? "").trim();
  if (raw) return `aside:${sha256Hex(raw).slice(0, 12)}`;
  return "aside:local";
}
