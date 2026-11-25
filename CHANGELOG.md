# Changelog

## 0.1.6 - 2026-11-25

### Added

- Every successful refresh writes `token refreshed: expires <iso> (written)` to magpie's plugin log,
  so a long run can be audited after the fact. The session window in the quota card still shows the
  live remaining lifetime.

### Verified

- A live agent message crossed the refresh boundary at 13:47:30Z: the plugin refreshed with about
  3.5 minutes left, wrote the token back, and the message continued without interruption.

## 0.1.5 - 2026-11-25

### Fixed

- The quota card keeps the token expiry meter alongside the real credit window. The session window is
  display-only (`aside: true`) and shows `Access token valid for ...`, so a long task can be watched
  across a refresh. The billing fallback still uses it when the credit call fails.

## 0.1.4 - 2026-11-25

### Fixed

- `package.json` now declares `magpie.options`, so magpie shows the Options button for the plugin.
  The editor starts from the plugin defaults and accepts raw JSON; `lang`, `showHiddenModels`,
  `allowRefresh`, `dataDir`, `baseOrigin` and `debug` can be set there.

## 0.1.3 - 2026-11-25

### Added

- Real quota card from `GET /billing/subscription`: plan, monthly credit remaining and grant, percent
  used, reset date and add-on credit. Cached for 60 seconds, with the session-lifetime window as the
  fallback when the call fails.

### Verified

- `GET /billing/subscription` returned 200 with the account token: `balance_micros` 17,990,498 of an
  18,000,000 grant, `used_percent` 1.
- The daemon's own `billing.*` tRPC procedures return 401 to a plain local client, so the plugin uses
  the cloud endpoint.
- 79 tests (78 pass, 1 live skipped).

## 0.1.2 - 2026-11-25

### Added

- `showHiddenModels` option (default `false`): also expose the six catalog models hidden by
  `visibleModelIds`, including the 1M-context `glm-5.3`, `glm-5.3-flash`, `deepseek-v4-flash`,
  `deepseek-v4-pro` and `kimi-k3.1`. Plan filtering still applies.

### Verified

- All six hidden models answered 200 on a `pro` account. `kimi-k3.1`, `glm-5.3` and
  `glm-5.3-flash` spend their first output tokens on reasoning, so a 16-token request returns empty
  content; with 256 tokens they answer normally.

## 0.1.1 - 2026-11-25

### Fixed

- UI language now defaults to `auto` and follows the system locale (`MAGPIE_LANG`, `LC_ALL`,
  `LC_MESSAGES`, `LANG`, then `Intl`). English systems show English method labels; `lang: "zh"` or
  `lang: "en"` still pins a language.

## 0.1.0 - 2026-11-25

### Added

- Provider `aside` with `@ai-sdk/openai-compatible` as the default SDK.
- Per-model endpoint routing: `@ai-sdk/openai` for `openai-responses`, `@ai-sdk/anthropic` for
  `anthropic-messages`, chat completions for everything else.
- Catalog from `GET /ai/catalog/v2` with a 60 second cache, plan filtering (`free` < `pro` < `max`)
  and `visibleModelIds` filtering. Built-in 2026-11-25 snapshot as fallback.
- Sign-in methods: Sign in with Google (opens Aside and adopts the session), read the local Aside
  account, paste an access token.
- Access token refresh through `POST /auth/token/refresh`, with atomic write-back to
  `accounts.json` and a compare-and-set guard.
- Loader that injects the browser User-Agent, `x-aside-provider`, `Authorization`, and
  `x-aside-model-id`, rewrites every URL from the configured origin, refuses redirects, and retries
  once after a 401 when the account file changed.
- Quota card with the plan, the account email and the remaining token lifetime.
- `chat.headers` hook that forwards magpie's session id as `x-aside-session-id`.
- Probe and E2E scripts; E2E writes a JSON and Markdown artifact.

### Verified

- 66 unit tests pass.
- Live E2E on 2026-11-25: chat streaming, tool calls, Anthropic Messages, OpenAI Responses and
  image input all returned 200 on a `pro` account.
- The gateway does not rotate the refresh token: two refreshes with the same token both returned
  200 and an identical refresh token.

### Known limits

- Google sign-in requires the Aside app. The OAuth flow is brokered by Aside's local daemon and
  cannot be completed by a plugin.
- No usage or billing API is reachable from a plugin, so the quota card shows no consumed amounts.
