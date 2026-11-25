import { VALIDATION_MODEL, VERIFY_TIMEOUT_MS } from "./constants.mjs";
import { apiBase, baseHeaders } from "./fetch.mjs";
import { t } from "./i18n.mjs";
import { accountIdFor } from "./modes.mjs";
import { parseErrorBody, trimSlash } from "./util.mjs";

export function successResult({
  token,
  email,
  plan,
  mode,
  dataDir,
  asideAccountId,
}) {
  return {
    type: "success",
    key: token,
    accountId: accountIdFor({ asideAccountId, email, token }),
    metadata: {
      mode,
      email: String(email ?? "").trim(),
      plan: String(plan ?? "").trim(),
      asideAccountId: String(asideAccountId ?? "").trim(),
      dataDir: String(dataDir ?? "").trim(),
    },
  };
}

export async function verifyAccessToken(
  origin,
  token,
  {
    fetchImpl = globalThis.fetch,
    model = VALIDATION_MODEL,
    timeoutMs = VERIFY_TIMEOUT_MS,
    lang = "zh",
  } = {},
) {
  let res;
  try {
    res = await fetchImpl(`${apiBase(trimSlash(origin))}/chat/completions`, {
      method: "POST",
      headers: {
        ...baseHeaders(),
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
        stream: false,
      }),
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return { ok: true, transient: true, error: String(err?.message ?? err) };
  }

  if (res.ok) {
    await res.text().catch(() => "");
    return { ok: true };
  }

  const text = await res.text().catch(() => "");
  const info = parseErrorBody(text);

  if (res.status === 401)
    return { ok: false, status: 401, error: t(lang, "errSignInExpired") };
  if (res.status === 403 && /1010|cloudflare/i.test(text)) {
    return { ok: false, status: 403, error: t(lang, "errCloudflare") };
  }
  return { ok: true, transient: true, status: res.status, error: info.message };
}
