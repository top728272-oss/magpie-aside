import test from "node:test";
import assert from "node:assert/strict";

import { AsidePlugin } from "../index.mjs";

const enabled = process.env.ASIDE_E2E === "1";

test(
  "live gateway: login, catalog, usage and all three API families",
  { skip: enabled ? false : "set ASIDE_E2E=1 to run the live gateway test" },
  async () => {
    const hooks = await AsidePlugin({}, { lang: "en" });
    const login = await hooks.auth.methods[0].authorize({
      dir: process.env.ASIDE_DATA_DIR ?? "",
      key: "auto",
    });
    assert.equal(login.type, "success", login.error);

    const auth = {
      type: "api",
      key: login.key,
      accountId: login.accountId,
      metadata: login.metadata,
    };
    const getAuth = async () => auth;

    const models = await hooks.provider.models({ models: {} }, { auth });
    const ids = Object.keys(models);
    assert.ok(ids.length > 0);
    assert.ok(ids.includes("gpt-6-luna"));
    assert.equal(models["gpt-6-luna"].provider.npm, "@ai-sdk/openai");
    assert.equal(models["claude-haiku-5-5"].provider.npm, "@ai-sdk/anthropic");

    const usage = await hooks.auth.usage(getAuth);
    assert.ok(usage.plan);
    assert.equal(usage.windows.length >= 1, true);
    assert.equal(usage.windows[0].unit, "USD");
    assert.match(usage.windows[0].display, /\$/);
    assert.equal(
      usage.windows.some((window) => window.aside === true),
      true,
    );

    const loader = await hooks.auth.loader(getAuth);

    const chat = await loader.fetch(`${loader.baseURL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "glm-5.3-flash",
        messages: [{ role: "user", content: "Reply with: pong" }],
        max_tokens: 16,
        stream: true,
      }),
    });
    assert.equal(chat.status, 200);
    assert.match(chat.headers.get("content-type") ?? "", /event-stream/);
    const streamText = await chat.text();
    assert.match(streamText, /^data: /m);
    assert.match(streamText, /\[DONE\]/);

    const messages = await loader.fetch(`${loader.baseURL}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-5-5",
        max_tokens: 16,
        messages: [{ role: "user", content: "ping" }],
      }),
    });
    assert.equal(messages.status, 200);
    const messagesJson = await messages.json();
    assert.ok(Array.isArray(messagesJson.content));
    assert.match(String(messagesJson.model), /claude/);

    const responses = await loader.fetch(`${loader.baseURL}/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-6-luna",
        input: "ping",
        max_output_tokens: 16,
        stream: false,
      }),
    });
    assert.equal(responses.status, 200);
    const responsesJson = await responses.json();
    assert.ok(Array.isArray(responsesJson.output));
    assert.match(String(responsesJson.model), /gpt-6/);
  },
);
