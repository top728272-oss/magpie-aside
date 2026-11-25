export const PROVIDER = "aside";
export const VERSION = "0.1.6";

export const DEFAULT_BASE_ORIGIN = "https://api.aside.com";
export const API_BASE_PATH = "/ai/v1";
export const CATALOG_PATH = "/ai/catalog/v2";
export const CATALOG_FALLBACK_PATHS = ["/ai/catalog/v1", "/ai/models/v2"];
export const REFRESH_PATH = "/auth/token/refresh";

export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";
export const ACCEPT_LANGUAGE = "en-US,en;q=0.9";

export const HEADER_PROVIDER = "x-aside-provider";
export const HEADER_MODEL = "x-aside-model-id";
export const HEADER_SESSION = "x-aside-session-id";
export const HEADER_SIGN_IN = "X-Magpie-Sign-In";

export const CATALOG_TTL_MS = 60_000;
export const BILLING_TTL_OK_MS = 60_000;
export const BILLING_TTL_ERR_MS = 30_000;
export const BILLING_TIMEOUT_MS = 4_000;
export const FILE_CACHE_TTL_MS = 3_000;
export const TOKEN_REFRESH_MARGIN_MS = 300_000;
export const REFRESH_TIMEOUT_MS = 20_000;
export const VERIFY_TIMEOUT_MS = 25_000;
export const MAX_JSON_BYTES = 1 << 20;

export const CREDENTIALS_FILE = "accounts.json";
export const HOME_ENV_NAMES = ["ASIDE_HOME", "ASIDE_HOME_PATH"];
export const DEFAULT_HOME_DIR = ".aside";

export const VALIDATION_MODEL = "glm-5.3-flash";

export const FAMILY_CHAT = "chat";
export const FAMILY_RESPONSES = "responses";
export const FAMILY_MESSAGES = "messages";

export const NPM_OPENAI_COMPATIBLE = "@ai-sdk/openai-compatible";
export const NPM_OPENAI = "@ai-sdk/openai";
export const NPM_ANTHROPIC = "@ai-sdk/anthropic";

export const PLAN_RANK = { free: 0, pro: 1, max: 2 };

export const MODE_BROWSER = "browser";
export const MODE_TOKEN = "token";
export const MODE_GOOGLE = "google";

export const DEFAULT_OPTIONS = {
  baseOrigin: DEFAULT_BASE_ORIGIN,
  dataDir: "",
  lang: "auto",
  debug: false,
  allowRefresh: true,
  showHiddenModels: false,
};

export const FALLBACK_MODELS = [
  {
    id: "gpt-6.2-astra",
    name: "GPT-6.2 Astra",
    minPlan: "pro",
    api: "openai-responses",
    reasoning: true,
    contextWindow: 272000,
    maxTokens: 128000,
    visible: true,
  },
  {
    id: "gpt-6.2-sol",
    name: "GPT-6.2 Sol",
    minPlan: "free",
    api: "openai-responses",
    reasoning: true,
    contextWindow: 272000,
    maxTokens: 128000,
    visible: true,
  },
  {
    id: "gpt-6.1-terra",
    name: "GPT-6.1 Terra",
    minPlan: "free",
    api: "openai-responses",
    reasoning: true,
    contextWindow: 272000,
    maxTokens: 128000,
    visible: true,
  },
  {
    id: "gpt-6-luna",
    name: "GPT-6 Luna",
    minPlan: "free",
    api: "openai-responses",
    reasoning: true,
    contextWindow: 400000,
    maxTokens: 128000,
    visible: true,
  },
  {
    id: "claude-fable-5-2",
    name: "Claude Fable 5.2",
    minPlan: "pro",
    api: "anthropic-messages",
    reasoning: true,
    contextWindow: 400000,
    maxTokens: 128000,
    visible: true,
  },
  {
    id: "claude-opus-5-5",
    name: "Claude Opus 5.5",
    minPlan: "pro",
    api: "anthropic-messages",
    reasoning: true,
    contextWindow: 400000,
    maxTokens: 128000,
    visible: true,
  },
  {
    id: "claude-opus-4-6",
    name: "Claude Opus 4.6",
    minPlan: "pro",
    api: "anthropic-messages",
    reasoning: true,
    contextWindow: 400000,
    maxTokens: 128000,
    visible: false,
  },
  {
    id: "claude-sonnet-5",
    name: "Claude Sonnet 5.5",
    minPlan: "free",
    api: "anthropic-messages",
    reasoning: true,
    contextWindow: 400000,
    maxTokens: 128000,
    visible: true,
  },
  {
    id: "claude-haiku-5-5",
    name: "Claude Haiku 5.5",
    minPlan: "free",
    api: "anthropic-messages",
    reasoning: true,
    contextWindow: 400000,
    maxTokens: 128000,
    visible: true,
  },
  {
    id: "gemini-4-argon",
    name: "Gemini 4 Argon",
    minPlan: "pro",
    api: "",
    reasoning: true,
    contextWindow: 400000,
    maxTokens: 65536,
    visible: true,
  },
  {
    id: "gemini-4-carbon",
    name: "Gemini 4 Carbon",
    minPlan: "pro",
    api: "",
    reasoning: true,
    contextWindow: 400000,
    maxTokens: 65536,
    visible: true,
  },
  {
    id: "gemini-4-neon",
    name: "Gemini 4 Neon",
    minPlan: "pro",
    api: "",
    reasoning: true,
    contextWindow: 400000,
    maxTokens: 65536,
    visible: true,
  },
  {
    id: "gemini-4-hydrogen",
    name: "Gemini 4 Hydrogen",
    minPlan: "free",
    api: "",
    reasoning: true,
    contextWindow: 400000,
    maxTokens: 65536,
    visible: true,
  },
  {
    id: "gemini-3.8-flash",
    name: "Gemini 3.8 Flash",
    minPlan: "free",
    api: "",
    reasoning: true,
    contextWindow: 400000,
    maxTokens: 64000,
    visible: true,
  },
  {
    id: "grok-4.7",
    name: "Grok 4.7",
    minPlan: "free",
    api: "openai-responses",
    reasoning: true,
    contextWindow: 500000,
    maxTokens: 128000,
    visible: true,
  },
  {
    id: "kimi-k3.1",
    name: "Kimi K3.1",
    minPlan: "pro",
    api: "",
    reasoning: true,
    contextWindow: 1000000,
    maxTokens: 64000,
    visible: false,
  },
  {
    id: "glm-5.3",
    name: "GLM 5.3",
    minPlan: "free",
    api: "",
    reasoning: true,
    contextWindow: 1000000,
    maxTokens: 131072,
    visible: false,
  },
  {
    id: "glm-5.3-flash",
    name: "GLM 5.3 Flash",
    minPlan: "free",
    api: "",
    reasoning: true,
    contextWindow: 1000000,
    maxTokens: 131000,
    visible: false,
  },
  {
    id: "deepseek-v4-flash",
    name: "DeepSeek v4.1 Flash",
    minPlan: "free",
    api: "",
    reasoning: true,
    contextWindow: 1040000,
    maxTokens: 64000,
    visible: false,
  },
  {
    id: "deepseek-v4-pro",
    name: "DeepSeek v4 Pro",
    minPlan: "pro",
    api: "",
    reasoning: true,
    contextWindow: 1040000,
    maxTokens: 64000,
    visible: false,
  },
];

export const FALLBACK_VISIBLE_IDS = FALLBACK_MODELS.filter(
  (m) => m.visible,
).map((m) => m.id);

export const FALLBACK_SNAPSHOT_DATE = "2026-11-25";
