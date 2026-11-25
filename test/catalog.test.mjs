import test from "node:test";
import assert from "node:assert/strict";

import {
  fallbackModels,
  familyOf,
  filterModels,
  modelsFromCatalog,
  normalizeCatalog,
  normalizeModel,
  toMagpieModel,
} from "../src/catalog.mjs";
import {
  NPM_ANTHROPIC,
  NPM_OPENAI,
  NPM_OPENAI_COMPATIBLE,
} from "../src/constants.mjs";

const CATALOG = {
  provider: "aside",
  version: 2,
  visibleModelIds: ["gpt-6-luna", "claude-sonnet-5", "glm-5.3-flash"],
  models: [
    {
      id: "gpt-6-luna",
      name: "GPT-6 Luna",
      minPlan: "free",
      api: "openai-responses",
      reasoning: true,
      contextWindow: 400000,
      maxTokens: 128000,
    },
    {
      id: "claude-sonnet-5",
      name: "Claude Sonnet 5.5",
      minPlan: "free",
      api: "anthropic-messages",
      reasoning: true,
      contextWindow: 400000,
      maxTokens: 128000,
    },
    {
      id: "claude-opus-5-5",
      name: "Claude Opus 5.5",
      minPlan: "pro",
      api: "anthropic-messages",
      reasoning: true,
      contextWindow: 400000,
      maxTokens: 128000,
    },
    {
      id: "glm-5.3-flash",
      name: "GLM 5.3 Flash",
      minPlan: "free",
      api: "",
      reasoning: true,
      contextWindow: 1000000,
      maxTokens: 131000,
    },
    {
      id: "gemini-4-argon",
      name: "Gemini 4 Argon",
      minPlan: "max",
      api: "",
      reasoning: true,
      contextWindow: 400000,
      maxTokens: 65536,
    },
    { id: "", name: "Broken" },
  ],
};

test("familyOf maps the catalog api field to an endpoint family", () => {
  assert.equal(familyOf("openai-responses"), "responses");
  assert.equal(familyOf("anthropic-messages"), "messages");
  assert.equal(familyOf(""), "chat");
  assert.equal(familyOf(undefined), "chat");
});

test("normalizeCatalog drops entries without an id and keeps the visible list", () => {
  const catalog = normalizeCatalog(CATALOG);
  assert.equal(catalog.provider, "aside");
  assert.equal(catalog.version, 2);
  assert.deepEqual(
    catalog.models.map((m) => m.id),
    [
      "gpt-6-luna",
      "claude-sonnet-5",
      "claude-opus-5-5",
      "glm-5.3-flash",
      "gemini-4-argon",
    ],
  );
  assert.deepEqual(catalog.visibleIds, [
    "gpt-6-luna",
    "claude-sonnet-5",
    "glm-5.3-flash",
  ]);
});

test("normalizeModel defaults an unknown plan to free and keeps limits", () => {
  const model = normalizeModel({
    id: "x",
    name: "",
    contextWindow: "1234",
    maxTokens: "99",
  });
  assert.equal(model.id, "x");
  assert.equal(model.name, "x");
  assert.equal(model.minPlan, "free");
  assert.equal(model.contextWindow, 1234);
  assert.equal(model.maxTokens, 99);
  assert.equal(model.reasoning, false);
});

test("filterModels applies the visible allowlist in the catalog order", () => {
  const catalog = normalizeCatalog(CATALOG);
  const models = filterModels(catalog.models, {
    visibleIds: catalog.visibleIds,
  });
  assert.deepEqual(
    models.map((m) => m.id),
    ["gpt-6-luna", "claude-sonnet-5", "glm-5.3-flash"],
  );
});

test("filterModels hides models above the account plan", () => {
  const catalog = normalizeCatalog(CATALOG);
  const free = filterModels(catalog.models, { plan: "free" });
  assert.deepEqual(
    free.map((m) => m.id),
    ["gpt-6-luna", "claude-sonnet-5", "glm-5.3-flash"],
  );

  const pro = filterModels(catalog.models, { plan: "pro" });
  assert.deepEqual(
    pro.map((m) => m.id),
    ["gpt-6-luna", "claude-sonnet-5", "claude-opus-5-5", "glm-5.3-flash"],
  );

  const max = filterModels(catalog.models, { plan: "max" });
  assert.equal(max.length, 5);
});

test("filterModels keeps every model when the plan is unknown", () => {
  const catalog = normalizeCatalog(CATALOG);
  const models = filterModels(catalog.models, { plan: "" });
  assert.equal(models.length, 5);
});

test("filterModels can include hidden models while still applying the plan", () => {
  const catalog = normalizeCatalog(CATALOG);
  const all = filterModels(catalog.models, { showHiddenModels: true });
  assert.equal(all.length, 5);

  const free = filterModels(catalog.models, {
    showHiddenModels: true,
    plan: "free",
  });
  assert.deepEqual(
    free.map((m) => m.id),
    ["gpt-6-luna", "claude-sonnet-5", "glm-5.3-flash"],
  );
});

test("toMagpieModel picks the SDK per endpoint family", () => {
  const base = { limit: { context: 999, output: 999 } };

  const chat = toMagpieModel(
    normalizeModel({ id: "a", api: "", contextWindow: 10, maxTokens: 5 }),
    base,
  );
  assert.equal(chat.name, "a");
  assert.equal(chat.limit.context, 10);
  assert.equal(chat.limit.output, 5);
  assert.equal(chat.provider, undefined);

  const responses = toMagpieModel(
    normalizeModel({ id: "b", api: "openai-responses" }),
    {},
  );
  assert.equal(responses.provider.npm, NPM_OPENAI);

  const messages = toMagpieModel(
    normalizeModel({ id: "c", api: "anthropic-messages" }),
    {},
  );
  assert.equal(messages.provider.npm, NPM_ANTHROPIC);

  assert.equal(NPM_OPENAI_COMPATIBLE, "@ai-sdk/openai-compatible");
});

test("toMagpieModel always exposes tool calls and image input", () => {
  const model = toMagpieModel(normalizeModel({ id: "x", reasoning: true }), {});
  assert.equal(model.tool_call, true);
  assert.equal(model.capabilities.toolcall, true);
  assert.equal(model.capabilities.attachment, true);
  assert.deepEqual(model.modalities.input, ["text", "image"]);
  assert.equal(model.reasoning, true);
});

test("modelsFromCatalog keys models by id and merges the base entry", () => {
  const models = modelsFromCatalog(normalizeCatalog(CATALOG).models, {
    "gpt-6-luna": { cost: { input: 1, output: 2 } },
  });
  assert.equal(models["gpt-6-luna"].name, "GPT-6 Luna");
  assert.deepEqual(models["gpt-6-luna"].cost, { input: 1, output: 2 });
  assert.equal(models["glm-5.3-flash"].name, "GLM 5.3 Flash");
  assert.equal(Object.keys(models).length, 5);
});

test("fallbackModels matches the visible catalog snapshot", () => {
  const models = fallbackModels({});
  assert.equal(Object.keys(models).length, 14);
  assert.equal(models["gpt-6-luna"].provider.npm, NPM_OPENAI);
  assert.equal(models["claude-sonnet-5"].provider.npm, NPM_ANTHROPIC);
  assert.equal(models["gemini-3.8-flash"].provider, undefined);
  assert.equal(models["claude-opus-4-6"], undefined);
  assert.equal(models["glm-5.3-flash"], undefined);
});
