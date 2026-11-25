import test from "node:test";
import assert from "node:assert/strict";

import { AsidePlugin, resolveOptions } from "../index.mjs";
import { makeJwt } from "./helpers.mjs";

test("plugin exposes the hooks magpie calls", async () => {
  const hooks = await AsidePlugin({}, {});
  assert.deepEqual(Object.keys(hooks).sort(), [
    "auth",
    "chat.headers",
    "config",
    "provider",
  ]);
  assert.equal(hooks.auth.provider, "aside");
  assert.equal(hooks.auth.methods.length, 3);
  assert.equal(hooks.auth.methods[0].type, "oauth");
  assert.equal(hooks.auth.methods[1].type, "api");
  assert.equal(hooks.auth.methods[2].type, "api");
  assert.equal(typeof hooks.auth.loader, "function");
  assert.equal(typeof hooks.auth.usage, "function");
  assert.equal(typeof hooks.auth.refresh, "function");
});

test("config declares the provider without overwriting user config", async () => {
  const hooks = await AsidePlugin({}, {});
  const cfg = {};
  await hooks.config(cfg);
  assert.equal(cfg.provider.aside.api, "https://api.aside.com/ai/v1");
  assert.equal(cfg.provider.aside.npm, "@ai-sdk/openai-compatible");
  assert.equal(Object.keys(cfg.provider.aside.models).length, 14);

  const existing = { provider: { aside: { name: "Mine" } } };
  await hooks.config(existing);
  assert.equal(existing.provider.aside.name, "Mine");
});

test("models without an account returns the fallback catalog", async () => {
  const hooks = await AsidePlugin({}, {});
  const models = await hooks.provider.models({ models: {} }, {});
  assert.equal(Object.keys(models).length, 14);
  assert.equal(models["gpt-6-luna"].provider.npm, "@ai-sdk/openai");
});

test("showHiddenModels exposes the full fallback catalog", async () => {
  const hooks = await AsidePlugin({}, { showHiddenModels: true });
  const cfg = {};
  await hooks.config(cfg);
  assert.equal(Object.keys(cfg.provider.aside.models).length, 20);

  const models = await hooks.provider.models({ models: {} }, {});
  assert.equal(Object.keys(models).length, 20);
  assert.equal(models["glm-5.3-flash"].limit.context, 1000000);
  assert.equal(models["deepseek-v4-flash"].limit.context, 1040000);
  assert.equal(models["claude-opus-4-6"].provider.npm, "@ai-sdk/anthropic");
});

test("usage reads plan and email from the access token", async () => {
  const token = makeJwt({
    exp: Math.floor(Date.now() / 1000) + 3600,
    plan: "max",
    email: "x@y.z",
  });
  const hooks = await AsidePlugin({}, { lang: "en" });
  const usage = await hooks.auth.usage(async () => ({
    type: "api",
    key: token,
    metadata: { mode: "token" },
  }));
  assert.equal(usage.plan, "Max");
  assert.equal(usage.user, "x@y.z");
  assert.match(usage.windows[0].display, /Access token valid for/);
});

test("chat.headers adds the Aside session header only for this provider", async () => {
  const hooks = await AsidePlugin({}, {});
  const output = { headers: {} };
  await hooks["chat.headers"](
    { model: { providerID: "aside" }, sessionID: "s-1" },
    output,
  );
  assert.equal(output.headers["x-aside-session-id"], "s-1");

  const other = { headers: {} };
  await hooks["chat.headers"](
    { model: { providerID: "openai" }, sessionID: "s-1" },
    other,
  );
  assert.deepEqual(other.headers, {});
});

test("resolveOptions merges function options and magpie options", () => {
  const opts = resolveOptions(
    { magpie: { options: { lang: "en" }, option: { debug: true } } },
    { dataDir: "/tmp/a" },
  );
  assert.equal(opts.lang, "en");
  assert.equal(opts.debug, true);
  assert.equal(opts.dataDir, "/tmp/a");
  assert.equal(opts.allowRefresh, true);
});
