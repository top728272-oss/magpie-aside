import {
  ACCEPT_LANGUAGE,
  BROWSER_USER_AGENT,
  CATALOG_FALLBACK_PATHS,
  CATALOG_PATH,
  CATALOG_TTL_MS,
  DEFAULT_BASE_ORIGIN,
  FALLBACK_MODELS,
  FALLBACK_VISIBLE_IDS,
  FAMILY_CHAT,
  FAMILY_MESSAGES,
  FAMILY_RESPONSES,
  NPM_ANTHROPIC,
  NPM_OPENAI,
} from "./constants.mjs";
import { HttpError, fetchJson } from "./http.mjs";
import { normalizePlan, planRank, toNumber, trimSlash } from "./util.mjs";

export function familyOf(api) {
  const value = String(api ?? "").trim();
  if (value === "openai-responses") return FAMILY_RESPONSES;
  if (value === "anthropic-messages") return FAMILY_MESSAGES;
  return FAMILY_CHAT;
}

export function normalizeModel(raw) {
  const id = String(raw?.id ?? "").trim();
  if (!id) return null;
  return {
    id,
    name: String(raw?.name ?? id).trim() || id,
    minPlan: normalizePlan(raw?.minPlan) || "free",
    api: String(raw?.api ?? "").trim(),
    reasoning: Boolean(raw?.reasoning),
    contextWindow: toNumber(raw?.contextWindow, 0),
    maxTokens: toNumber(raw?.maxTokens, 0),
    thinkingLevels: Array.isArray(raw?.availableThinkingLevels)
      ? raw.availableThinkingLevels.map((item) => String(item)).filter(Boolean)
      : [],
    fastMode: Boolean(raw?.supportsFastMode),
    visible: raw?.visible === undefined ? true : Boolean(raw.visible),
  };
}

function dedupe(models) {
  const seen = new Set();
  const out = [];
  for (const model of models) {
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    out.push(model);
  }
  return out;
}

export function normalizeCatalog(payload) {
  const raw = Array.isArray(payload?.models) ? payload.models : [];
  const visibleIds = Array.isArray(payload?.visibleModelIds)
    ? payload.visibleModelIds.map(String)
    : [];
  return {
    provider: String(payload?.provider ?? "").trim(),
    version: toNumber(payload?.version, 0),
    models: dedupe(raw.map(normalizeModel).filter(Boolean)),
    visibleIds,
  };
}

export function filterModels(
  models,
  { plan = "", visibleIds = [], showHiddenModels = false } = {},
) {
  const visible = new Set(visibleIds.map(String));
  const rank = planRank(plan);
  const out = models.filter((model) => {
    if (!showHiddenModels && visible.size > 0 && !visible.has(model.id))
      return false;
    if (rank >= 0 && planRank(model.minPlan) > rank) return false;
    return true;
  });
  if (!showHiddenModels && visible.size > 0) {
    const order = new Map(visibleIds.map((id, index) => [String(id), index]));
    out.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }
  return out;
}

export function toMagpieModel(model, base = {}) {
  const family = familyOf(model.api);
  const out = {
    ...base,
    id: model.id,
    name: model.name || model.id,
    limit: {
      context: model.contextWindow || base?.limit?.context || 0,
      output: model.maxTokens || base?.limit?.output || 4096,
    },
    reasoning: model.reasoning,
    tool_call: true,
    modalities: { input: ["text", "image"] },
    capabilities: {
      reasoning: model.reasoning,
      toolcall: true,
      attachment: true,
      input: { text: true, image: true },
    },
  };

  if (family === FAMILY_RESPONSES) {
    out.provider = { ...(base?.provider ?? {}), npm: NPM_OPENAI };
  } else if (family === FAMILY_MESSAGES) {
    out.provider = { ...(base?.provider ?? {}), npm: NPM_ANTHROPIC };
  }

  return out;
}

export function modelsFromCatalog(models, baseModels = {}) {
  const out = {};
  for (const model of models) {
    out[model.id] = toMagpieModel(model, baseModels?.[model.id] ?? {});
  }
  return out;
}

export const FALLBACK_CATALOG =
  FALLBACK_MODELS.map(normalizeModel).filter(Boolean);

export function fallbackModels(
  baseModels = {},
  { showHiddenModels = false } = {},
) {
  const models = filterModels(FALLBACK_CATALOG, {
    visibleIds: FALLBACK_VISIBLE_IDS,
    showHiddenModels,
  });
  return modelsFromCatalog(models, baseModels);
}

export function createCatalogCache({
  ttlMs = CATALOG_TTL_MS,
  now = () => Date.now(),
} = {}) {
  const map = new Map();
  return {
    async get(key, fetcher, { force = false } = {}) {
      const hit = map.get(key);
      if (hit && !force && now() - hit.at < ttlMs) return hit.value;
      const value = await fetcher();
      map.set(key, { at: now(), value });
      return value;
    },
    peek(key) {
      return map.get(key)?.value;
    },
    clear() {
      map.clear();
    },
    get size() {
      return map.size;
    },
  };
}

function catalogHeaders() {
  return {
    Accept: "application/json",
    "Accept-Language": ACCEPT_LANGUAGE,
    "User-Agent": BROWSER_USER_AGENT,
  };
}

export async function fetchCatalog(
  origin,
  { fetchImpl = globalThis.fetch, timeoutMs = 20_000 } = {},
) {
  const base = trimSlash(origin || DEFAULT_BASE_ORIGIN);
  let lastError = null;

  for (const path of [CATALOG_PATH, ...CATALOG_FALLBACK_PATHS]) {
    try {
      const payload = await fetchJson(`${base}${path}`, {
        fetchImpl,
        headers: catalogHeaders(),
        timeoutMs,
      });
      const catalog = normalizeCatalog(payload);
      if (catalog.models.length > 0) return { ...catalog, path };
      lastError = new Error(`empty catalog at ${path}`);
    } catch (err) {
      lastError = err;
      if (err instanceof HttpError && err.status === 404) continue;
      throw err;
    }
  }

  throw lastError ?? new Error("catalog unavailable");
}

export function catalogSummary(models) {
  const free = models.filter((model) => planRank(model.minPlan) <= 0).length;
  return `${models.length} models (${free} free, ${models.length - free} paid)`;
}
