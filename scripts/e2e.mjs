import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { AsidePlugin } from "../index.mjs";
import { VERSION } from "../src/constants.mjs";
import { fetchCatalog } from "../src/catalog.mjs";
import { credentialsPath } from "../src/credentials.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
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

function familyOfModel(model) {
  const npm = model?.provider?.npm;
  if (npm === "@ai-sdk/openai") return "responses";
  if (npm === "@ai-sdk/anthropic") return "messages";
  return "chat";
}

async function readAll(res) {
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { text, json };
}

const checks = [];

function record(name, ok, detail, extra = {}) {
  checks.push({ name, ok, detail, ...extra });
  const mark = ok ? "PASS" : "FAIL";
  console.log(`  [${mark}] ${name}: ${detail}`);
}

const dataDir = arg("dir", "");
const hooks = await AsidePlugin({ magpie: { options: { lang: "en" } } }, {});
const login = await hooks.auth.methods[0].authorize({
  dir: dataDir,
  key: "auto",
});

if (login?.type !== "success") {
  console.error(`login failed: ${login?.error ?? "unknown error"}`);
  process.exit(1);
}

const auth = {
  type: "api",
  key: login.key,
  accountId: login.accountId,
  metadata: login.metadata,
};
const getAuth = async () => auth;
const loader = await hooks.auth.loader(getAuth);

console.log("magpie-aside e2e");
console.log(
  `  account: ${auth.accountId} | plan: ${login.metadata.plan || "-"} | email: ${maskEmail(login.metadata.email)}`,
);
console.log(
  `  credentials: ${credentialsPath({ explicitDir: login.metadata.dataDir || dataDir })}`,
);

let catalog = null;
try {
  catalog = await fetchCatalog("https://api.aside.com", {});
} catch (err) {
  console.error(`catalog failed: ${err?.message ?? err}`);
}

const models = await hooks.provider.models({ models: {} }, { auth });
const ids = Object.keys(models);
const byFamily = { chat: [], responses: [], messages: [] };
for (const id of ids) byFamily[familyOfModel(models[id])].push(id);

console.log(
  `  models: ${ids.length} (chat ${byFamily.chat.length}, responses ${byFamily.responses.length}, messages ${byFamily.messages.length})`,
);
record("catalog", ids.length > 0, `${ids.length} models exposed`, {
  families: byFamily,
});

const usage = await hooks.auth.usage(getAuth);
record(
  "usage",
  Boolean(usage?.plan),
  `${usage?.plan ?? "-"} / ${usage?.windows?.[0]?.display ?? "-"}`,
  { usage },
);

const billingOk = usage?.windows?.[0]?.unit === "USD";
record(
  "billing",
  billingOk,
  billingOk
    ? `${usage.balance ?? ""} · ${usage.windows[0].display}`
    : "billing unavailable, session fallback",
);

const session = usage?.windows?.find((window) => window.aside === true);
record(
  "session-meter",
  Boolean(session),
  session?.display ?? "missing token expiry window",
);

const chatModel = arg(
  "chat-model",
  byFamily.chat.includes("glm-5.3-flash") ? "glm-5.3-flash" : byFamily.chat[0],
);
const messagesModel = arg(
  "messages-model",
  byFamily.messages.includes("claude-haiku-5-5")
    ? "claude-haiku-5-5"
    : byFamily.messages[0],
);
const responsesModel = arg(
  "responses-model",
  byFamily.responses.includes("gpt-6-luna")
    ? "gpt-6-luna"
    : byFamily.responses[0],
);

if (chatModel) {
  const started = Date.now();
  const res = await loader.fetch(`${loader.baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
    },
    body: JSON.stringify({
      model: chatModel,
      messages: [{ role: "user", content: "Reply with the single word: pong" }],
      max_tokens: 32,
      stream: true,
    }),
  });
  const text = await res.text();
  const events = text
    .split("\n")
    .filter((line) => line.startsWith("data:")).length;
  const ok = res.ok && text.includes("[DONE]") && events > 0;
  record(
    "chat-stream",
    ok,
    `${chatModel} HTTP ${res.status}, ${events} SSE events, ${Date.now() - started} ms`,
    {
      status: res.status,
      model: chatModel,
      sample: text.slice(0, 400),
    },
  );
}

if (chatModel) {
  const started = Date.now();
  const res = await loader.fetch(`${loader.baseURL}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      model: chatModel,
      messages: [
        {
          role: "user",
          content: "What is the weather in Paris? Call the tool.",
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "get_weather",
            description: "Get the current weather for a city",
            parameters: {
              type: "object",
              properties: { city: { type: "string" } },
              required: ["city"],
            },
          },
        },
      ],
      tool_choice: "required",
      max_tokens: 256,
      stream: false,
    }),
  });
  const { json } = await readAll(res);
  const calls = json?.choices?.[0]?.message?.tool_calls ?? [];
  const ok =
    res.ok &&
    calls.length > 0 &&
    String(calls[0]?.function?.name ?? "") === "get_weather";
  record(
    "chat-tool-call",
    ok,
    `${chatModel} HTTP ${res.status}, tool_calls ${calls.length}, ${Date.now() - started} ms`,
    {
      status: res.status,
      arguments: calls[0]?.function?.arguments ?? "",
    },
  );
}

if (messagesModel) {
  const started = Date.now();
  const res = await loader.fetch(`${loader.baseURL}/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: messagesModel,
      max_tokens: 32,
      messages: [{ role: "user", content: "ping" }],
    }),
  });
  const { json } = await readAll(res);
  const ok = res.ok && Array.isArray(json?.content) && json.content.length > 0;
  record(
    "messages",
    ok,
    `${messagesModel} HTTP ${res.status}, ${json?.usage?.output_tokens ?? "?"} output tokens, ${Date.now() - started} ms`,
    {
      status: res.status,
      model: json?.model ?? "",
    },
  );
}

if (responsesModel) {
  const started = Date.now();
  const res = await loader.fetch(`${loader.baseURL}/responses`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      model: responsesModel,
      input: "ping",
      max_output_tokens: 32,
      stream: false,
    }),
  });
  const { json } = await readAll(res);
  const ok = res.ok && Array.isArray(json?.output) && json.output.length > 0;
  record(
    "responses",
    ok,
    `${responsesModel} HTTP ${res.status}, ${json?.usage?.output_tokens ?? "?"} output tokens, ${Date.now() - started} ms`,
    {
      status: res.status,
      model: json?.model ?? "",
    },
  );
}

const ok = checks.every((check) => check.ok);
const artifact = {
  generatedAt: new Date().toISOString(),
  plugin: { name: "magpie-aside", version: VERSION },
  account: {
    accountId: auth.accountId,
    plan: login.metadata.plan ?? "",
    email: maskEmail(login.metadata.email),
  },
  catalog: catalog
    ? {
        version: catalog.version,
        path: catalog.path,
        models: catalog.models.length,
        visible: catalog.visibleIds.length,
        snapshot: catalog.models.map((model) => ({
          id: model.id,
          api: model.api || "chat",
          minPlan: model.minPlan,
        })),
      }
    : null,
  exposed: { count: ids.length, families: byFamily },
  usage,
  checks,
  ok,
};

const dir = join(root, "artifacts");
mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const jsonPath = join(dir, `e2e-${stamp}.json`);
const mdPath = join(dir, `e2e-${stamp}.md`);
writeFileSync(jsonPath, JSON.stringify(artifact, null, 2), "utf8");

const lines = [
  "# magpie-aside e2e",
  "",
  `- Generated: ${artifact.generatedAt}`,
  `- Plugin: ${artifact.plugin.name} ${artifact.plugin.version}`,
  `- Account: ${artifact.account.accountId} (${artifact.account.plan || "unknown plan"}, ${artifact.account.email || "no email"})`,
  `- Models exposed: ${artifact.exposed.count} (chat ${byFamily.chat.length}, responses ${byFamily.responses.length}, messages ${byFamily.messages.length})`,
  `- Session: ${usage?.windows?.[0]?.display ?? "-"}`,
  "",
  "| Check | Result | Detail |",
  "|---|---|---|",
  ...checks.map(
    (check) =>
      `| ${check.name} | ${check.ok ? "PASS" : "FAIL"} | ${check.detail} |`,
  ),
  "",
  `Overall: ${ok ? "PASS" : "FAIL"}`,
  "",
];
writeFileSync(mdPath, lines.join("\n"), "utf8");

console.log(`\nartifact: ${jsonPath}`);
console.log(`artifact: ${mdPath}`);
console.log(ok ? "OVERALL PASS" : "OVERALL FAIL");
process.exitCode = ok ? 0 : 1;
