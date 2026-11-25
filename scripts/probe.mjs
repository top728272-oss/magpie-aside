import { fetchCatalog } from "../src/catalog.mjs";
import { readAccounts } from "../src/credentials.mjs";
import { apiBase, baseHeaders } from "../src/fetch.mjs";
import { formatDuration, tokenClaims } from "../src/util.mjs";

const argv = process.argv.slice(2);

function arg(name, fallback = "") {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : fallback;
}

function maskEmail(email) {
  const [name, domain] = String(email ?? "").split("@");
  if (!domain) return "";
  return `${name.slice(0, 1)}***@${domain}`;
}

const dir = arg("dir", "");
const origin = arg("origin", "https://api.aside.com");

console.log("magpie-aside probe");
console.log(`  origin: ${origin}`);

const found = readAccounts({ explicitDir: dir });
if (!found.ok) {
  console.log(`  credentials: not found (tried ${found.tried.join(", ")})`);
} else {
  const claims = tokenClaims(found.session.accessToken);
  const expiresAt = found.session.expiresAt || claims?.expiresAt || 0;
  const left = expiresAt - Date.now();
  console.log(`  credentials: ${found.path}`);
  console.log(
    `  account: ${found.accountId} | provider: ${found.account?.provider ?? "-"} | plan: ${found.account?.subscriptionPlan ?? "-"}`,
  );
  console.log(`  email: ${maskEmail(claims?.email || found.account?.email)}`);
  console.log(
    `  token: ${claims?.type || "unknown"} | expires ${new Date(expiresAt).toISOString()} (${left > 0 ? `in ${formatDuration(left, "en")}` : "expired"})`,
  );
  console.log(
    `  refresh token: ${found.session.refreshToken ? "present" : "missing"}`,
  );
}

try {
  const catalog = await fetchCatalog(origin, {});
  const families = { chat: 0, responses: 0, messages: 0 };
  for (const model of catalog.models) {
    const key =
      model.api === "openai-responses"
        ? "responses"
        : model.api === "anthropic-messages"
          ? "messages"
          : "chat";
    families[key] += 1;
  }
  console.log(
    `  catalog: ${catalog.path} | version ${catalog.version} | ${catalog.models.length} models`,
  );
  console.log(
    `  families: chat ${families.chat}, responses ${families.responses}, messages ${families.messages}`,
  );
  console.log(`  visible: ${catalog.visibleIds.length}`);
  console.log("");
  console.log("  id                      api          plan   ctx      out");
  for (const model of catalog.models) {
    const api = model.api || "chat";
    console.log(
      `  ${model.id.padEnd(23)} ${api.padEnd(12)} ${model.minPlan.padEnd(6)} ${String(model.contextWindow).padEnd(8)} ${model.maxTokens}`,
    );
  }
} catch (err) {
  console.log(`  catalog: failed (${err?.message ?? err})`);
}

if (argv.includes("--live") && found.ok) {
  const res = await fetch(`${apiBase(origin)}/chat/completions`, {
    method: "POST",
    headers: {
      ...baseHeaders(),
      "Content-Type": "application/json",
      Authorization: `Bearer ${found.session.accessToken}`,
    },
    body: JSON.stringify({
      model: arg("model", "glm-5.3-flash"),
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1,
      stream: false,
    }),
    redirect: "error",
    signal: AbortSignal.timeout(25_000),
  });
  const body = await res.text();
  console.log(`  live chat: HTTP ${res.status} | ${body.slice(0, 200)}`);
}
