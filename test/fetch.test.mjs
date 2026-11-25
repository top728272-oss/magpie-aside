import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

import {
  createLoader,
  guardResponse,
  modelIdFromBody,
  normalizeIncomingUrl,
} from "../src/fetch.mjs";
import { createSessionStore } from "../src/session.mjs";
import {
  fakeFetch,
  jsonResponse,
  makeAccounts,
  makeJwt,
  makeTempDir,
  writeAccountsFile,
} from "./helpers.mjs";

const ORIGIN = "https://api.aside.com";
const NOW = 1_800_000_000_000;

test("normalizeIncomingUrl routes each family to its endpoint", () => {
  const settings = { origin: ORIGIN };
  assert.equal(
    normalizeIncomingUrl(
      "https://api.aside.com/ai/v1/chat/completions?alt=sse",
      settings,
    ),
    `${ORIGIN}/ai/v1/chat/completions?alt=sse`,
  );
  assert.equal(
    normalizeIncomingUrl("https://api.aside.com/ai/v1/messages", settings),
    `${ORIGIN}/ai/v1/messages`,
  );
  assert.equal(
    normalizeIncomingUrl("https://api.aside.com/ai/v1/messages/", settings),
    `${ORIGIN}/ai/v1/messages`,
  );
  assert.equal(
    normalizeIncomingUrl("https://api.aside.com/ai/v1/responses", settings),
    `${ORIGIN}/ai/v1/responses`,
  );
  assert.equal(
    normalizeIncomingUrl("https://api.aside.com/ai/v1/responses/", settings),
    `${ORIGIN}/ai/v1/responses`,
  );
  assert.equal(
    normalizeIncomingUrl("/messages", settings),
    `${ORIGIN}/ai/v1/messages`,
  );
});

test("modelIdFromBody reads the model field and tolerates garbage", () => {
  assert.equal(
    modelIdFromBody(JSON.stringify({ model: "gpt-6-luna" })),
    "gpt-6-luna",
  );
  assert.equal(modelIdFromBody("{}"), "");
  assert.equal(modelIdFromBody("not json"), "");
  assert.equal(modelIdFromBody(undefined), "");
});

test("loader injects Aside headers and removes provider key headers", async () => {
  const fetchImpl = fakeFetch(() => jsonResponse({ ok: true }));
  const loader = createLoader(
    async () => ({
      type: "api",
      key: "test-token",
      metadata: { mode: "token" },
    }),
    { baseOrigin: ORIGIN },
    { fetchImpl },
  );

  const res = await loader.fetch(
    "https://api.aside.com/ai/v1/chat/completions",
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "drop-me" },
      body: JSON.stringify({ model: "gpt-6-luna", messages: [] }),
    },
  );

  assert.equal(res.status, 200);
  const call = fetchImpl.calls[0];
  const headers = new Headers(call.init.headers);
  assert.equal(call.url, `${ORIGIN}/ai/v1/chat/completions`);
  assert.equal(headers.get("authorization"), "Bearer test-token");
  assert.equal(headers.get("x-aside-provider"), "true");
  assert.equal(headers.get("x-aside-model-id"), "gpt-6-luna");
  assert.equal(headers.get("x-api-key"), null);
  assert.match(headers.get("user-agent"), /Mozilla\/5\.0/);
  assert.equal(call.init.redirect, "error");
});

test("loader rewrites the messages endpoint and keeps the query", async () => {
  const fetchImpl = fakeFetch(() => jsonResponse({ ok: true }));
  const loader = createLoader(
    async () => ({
      type: "api",
      key: "test-token",
      metadata: { mode: "token" },
    }),
    { baseOrigin: ORIGIN },
    { fetchImpl },
  );

  await loader.fetch("https://api.aside.com/ai/v1/messages?beta=1", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-haiku-5-5", messages: [] }),
  });

  assert.equal(fetchImpl.calls[0].url, `${ORIGIN}/ai/v1/messages?beta=1`);
});

test("loader retries once when the account file changed after a 401", async () => {
  const dir = makeTempDir();
  try {
    const stale = makeJwt({ exp: Math.floor(NOW / 1000) + 3600 });
    const fresh = makeJwt({ exp: Math.floor(NOW / 1000) + 7200 });
    const path = writeAccountsFile(
      dir,
      makeAccounts({ accessToken: stale, expiresAt: NOW + 3600_000 }),
    );

    let chatCalls = 0;
    const fetchImpl = fakeFetch((url) => {
      if (!url.includes("/chat/completions"))
        return jsonResponse({}, { status: 500 });
      chatCalls += 1;
      if (chatCalls === 1) {
        writeAccountsFile(
          dir,
          makeAccounts({ accessToken: fresh, expiresAt: NOW + 7200_000 }),
        );
        return new Response(
          JSON.stringify({
            error: "Token expired",
            code: "ACCESS_TOKEN_EXPIRED",
          }),
          {
            status: 401,
            headers: { "content-type": "application/json" },
          },
        );
      }
      return jsonResponse({ ok: true });
    });

    const sessions = createSessionStore({
      options: { baseOrigin: ORIGIN },
      deps: { fetchImpl, now: () => NOW },
    });
    const loader = createLoader(
      async () => ({
        type: "api",
        key: stale,
        metadata: { mode: "browser", dataDir: path },
      }),
      { baseOrigin: ORIGIN },
      { fetchImpl, sessions },
    );

    const res = await loader.fetch(
      "https://api.aside.com/ai/v1/chat/completions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "glm-5.3-flash", messages: [] }),
      },
    );

    assert.equal(res.status, 200);
    assert.equal(chatCalls, 2);
    const second = new Headers(fetchImpl.calls[1].init.headers);
    assert.equal(second.get("authorization"), `Bearer ${fresh}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("guardResponse flags a 401 as an expired sign-in", async () => {
  const res = await guardResponse(
    new Response(
      JSON.stringify({ error: "Token expired", code: "ACCESS_TOKEN_EXPIRED" }),
      {
        status: 401,
        headers: { "content-type": "application/json", "content-length": "60" },
      },
    ),
  );
  assert.equal(res.status, 401);
  assert.equal(res.headers.get("x-magpie-sign-in"), "expired");
  assert.equal(res.headers.get("content-length"), null);
  assert.match(await res.text(), /ACCESS_TOKEN_EXPIRED/);
});

test("guardResponse leaves other statuses untouched", async () => {
  const original = new Response("nope", { status: 403 });
  const res = await guardResponse(original);
  assert.equal(res, original);
});
