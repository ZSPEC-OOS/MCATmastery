import { anthropic } from "./anthropic";
import { getModels } from "./firestore";
import type { ModelConfig, ModelRole } from "./firestore";

// ── Active model resolution ───────────────────────────────────────────────────
// Caches the full model list for 30 seconds to avoid a Firestore round-trip on
// every request. Storing all models (not just models[0]) lets role-aware
// callers pick the right model from the same cache.

let _cachedModels: ModelConfig[] | undefined = undefined;
let _expiry = 0;

async function getAllModels(): Promise<ModelConfig[]> {
  if (_cachedModels !== undefined && Date.now() < _expiry) return _cachedModels;
  try {
    _cachedModels = await getModels();
    _expiry = Date.now() + 30_000;
    return _cachedModels;
  } catch {
    return _cachedModels ?? [];
  }
}

export async function getActiveModel(): Promise<ModelConfig | null> {
  const models = await getAllModels();
  return models.find((m) => m.role !== "disabled") ?? null;
}

// Returns the best model for a given role. Handles comma-separated multi-role
// strings ("generation,formatting") and the legacy "both" value (=generation+audit).
export async function getModelForRole(role: string): Promise<ModelConfig | null> {
  const models = await getAllModels();
  function hasRole(stored: string): boolean {
    if (!stored || stored === "disabled") return false;
    if (stored === "both") return role === "generation" || role === "audit";
    return stored.split(",").map(r => r.trim()).includes(role);
  }
  return models.find((m) => hasRole(m.role))
    ?? models.find((m) => m.role !== "disabled")
    ?? null;
}

// ── Shared model caller ───────────────────────────────────────────────────────
// All AI calls in the app go through here so that whichever model is attached
// via the admin Settings page is used everywhere automatically.
//
// Admin routes pass explicit modelId/baseUrl/apiKey when the user picks a
// specific model. All other routes (practice, pipelines) omit those fields and
// get the active model resolved automatically.

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function callModel(opts: {
  system:                 string;
  userContent:            string;
  maxTokens:              number;
  modelId?:               string;   // explicit override (admin routes)
  baseUrl?:               string;
  apiKey?:                string;
  modelMaxTokens?:        number;   // from model config; overrides maxTokens when set
  modelMaxReasoningTokens?: number; // cap thinking budget; reserves room for actual output
}, attempt = 0): Promise<string> {
  const retry = async () => {
    await sleep(Math.min(2 ** attempt * 2000, 32000));
    return callModel(opts, attempt + 1);
  };

  // Resolve credentials. If the caller already knows the model (generate routes),
  // modelId is set and we skip the Firestore lookup — but we still need to honour
  // the per-model maxTokens stored in the config (modelMaxTokens).
  let { modelId, baseUrl, apiKey } = opts;
  let maxTokens           = opts.modelMaxTokens ?? opts.maxTokens;
  let maxReasoningTokens  = opts.modelMaxReasoningTokens;
  if (!modelId) {
    const active = await getActiveModel();
    if (active) {
      modelId   = active.modelId;
      baseUrl   = active.baseUrl   || undefined;
      apiKey    = active.apiKey    || undefined;
      // -1 is the "unlimited" sentinel — include it so the API path can omit max_tokens
      if (active.maxTokens !== undefined && active.maxTokens !== null) maxTokens = active.maxTokens;
      if (active.maxReasoningTokens) maxReasoningTokens = active.maxReasoningTokens;
    }
  }

  // Custom OpenAI-compatible endpoint
  if (baseUrl) {
    const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const messages = [
      { role: "system", content: opts.system },
      { role: "user",   content: opts.userContent },
    ];

    // -1 means unlimited — omit the token param so the provider uses its own default
    const tokenLimit = maxTokens > 0 ? maxTokens : undefined;

    const buildBody = (tokenParam: "max_tokens" | "max_completion_tokens", msgs: typeof messages) =>
      JSON.stringify({
        model: modelId,
        messages: msgs,
        ...(tokenLimit !== undefined ? { [tokenParam]: tokenLimit } : {}),
        ...(maxReasoningTokens ? { max_reasoning_tokens: maxReasoningTokens } : {}),
      });

    const doFetch = (tokenParam: "max_tokens" | "max_completion_tokens", msgs = messages) =>
      fetch(url, {
        method:  "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: buildBody(tokenParam, msgs),
      });

    // Try max_tokens first; fall back to max_completion_tokens on 400 (o1/o3/gpt-5+)
    let res = await doFetch("max_tokens");
    let tokenParam: "max_tokens" | "max_completion_tokens" = "max_tokens";
    if (res.status === 400) {
      const errText = await res.text().catch(() => "");
      if (errText.includes("max_tokens")) {
        tokenParam = "max_completion_tokens";
        res = await doFetch(tokenParam);
      } else {
        throw new Error(`Model API error 400: ${errText.slice(0, 200)}`);
      }
    }

    if (!res.ok) {
      if ((res.status === 429 || res.status >= 500) && attempt < 4) return retry();
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Model API error ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = await res.json() as {
      choices?: Array<{
        finish_reason?: string;
        message?: { content?: string | Array<{ type: string; text?: string }> | null; reasoning_content?: string | null };
      }>;
      error?: unknown;
      usage?: { prompt_cache_hit_tokens?: number; prompt_cache_miss_tokens?: number };
    };
    // DeepSeek caches repeated prompt prefixes automatically (no request flag) and reports hits and misses here.
    if (data.usage?.prompt_cache_hit_tokens !== undefined) {
      console.log(`[model] prompt cache: ${data.usage.prompt_cache_hit_tokens} hit, ${data.usage.prompt_cache_miss_tokens ?? 0} miss`);
    }
    const choice       = data.choices?.[0];
    const msg          = choice?.message;
    const finishReason = choice?.finish_reason;
    const raw          = msg?.content;
    let content: string | null = null;
    if (typeof raw === "string") {
      content = raw || null;
    } else if (Array.isArray(raw)) {
      content = raw.filter((b) => b?.type === "text" && b?.text).map((b) => b.text).join("") || null;
    }
    // DeepSeek reasoning models put chain-of-thought in reasoning_content; fall
    // back to it only when it looks like JSON (not raw thinking prose).
    if (!content && typeof msg?.reasoning_content === "string" && msg.reasoning_content) {
      const rc = msg.reasoning_content.trim();
      if (rc.startsWith("{") || rc.startsWith("[")) content = rc;
    }

    // When the API cuts the response short (finish_reason: length) and we got
    // partial content, try one continuation using the same tokenParam that worked.
    if (content && finishReason === "length") {
      try {
        const contMessages = [
          { role: "system",    content: opts.system },
          { role: "user",      content: opts.userContent },
          { role: "assistant", content },
          { role: "user",      content: "Continue your JSON exactly from where you stopped. Output ONLY the remaining JSON — no commentary, no markdown." },
        ] as typeof messages;
        const contRes = await doFetch(tokenParam, contMessages);
        if (contRes.ok) {
          const contData = await contRes.json() as typeof data;
          const contRaw  = contData.choices?.[0]?.message?.content;
          const contText = typeof contRaw === "string" ? contRaw : (Array.isArray(contRaw) ? contRaw.map((b) => b?.text ?? "").join("") : "");
          if (contText) content = content + contText;
        }
      } catch { /* fall through and try to parse what we have */ }
    }

    if (!content) {
      const hint = data.error
        ? ` API error: ${JSON.stringify(data.error).slice(0, 200)}`
        : ` Response: ${JSON.stringify(data).slice(0, 200)}`;
      const isReasoning  = typeof msg?.reasoning_content === "string" && !!msg.reasoning_content;
      const isExhausted  = isReasoning && finishReason === "length";
      if (isExhausted) {
        throw new Error(`Reasoning model exhausted its token budget on thinking before writing output. Edit this model in Settings and set "Max Reasoning Tokens" (e.g. 8000) to cap the thinking budget.`);
      }
      if (isReasoning) {
        throw new Error(`Reasoning model returned empty content — thinking was present but no output was written. Try setting Max Reasoning Tokens in Settings.`);
      }
      throw new Error(`Model returned empty content.${hint}`);
    }
    return content;
  }

  // Anthropic SDK fallback
  try {
    // Anthropic requires a positive max_tokens; use 16384 when unlimited (-1) is requested
    const anthropicMaxTokens = maxTokens > 0 ? maxTokens : 16384;
    const msg = await anthropic.messages.create({
      model:      modelId ?? "claude-opus-4-7",
      max_tokens: anthropicMaxTokens,
      system:     opts.system,
      messages:   [{ role: "user", content: opts.userContent }],
    });
    const block = msg.content[0];
    if (!block || block.type !== "text" || !block.text) {
      throw new Error(`Anthropic model returned no text content (block type: ${block?.type ?? "none"})`);
    }
    return block.text;
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if ((status === 429 || status === 529 || status === 503) && attempt < 4) return retry();
    throw err;
  }
}
