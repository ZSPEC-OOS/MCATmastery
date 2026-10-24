// Which model Codex uses (Admin → Settings → Custom Models):
//   1. a model with the "Codex" role checked, for every Codex call (planning, writing, solving, reviewing);
//   2. otherwise, as before: the "generation" model writes, the "audit" model solves blind and reviews.
// Everything goes through Mastery's callModel.

import { callModel, getModelForRole } from "../model";
import { getModels } from "../firestore";
import type { ModelConfig } from "../firestore";
import { extractModelJson } from "../parse";
import { UnparseableOutput } from "./engine";
import type { ModelCaller } from "./engine";

const hasCodexRole = (m: ModelConfig) =>
  !!m.role && m.role !== "disabled" && m.role.split(",").map((r) => r.trim()).includes("codex");

let cache: { at: number; model: ModelConfig | null } | null = null;

/** The model flagged for Codex, cached briefly so each call does not re-read Firestore. */
async function codexModel(): Promise<ModelConfig | null> {
  if (cache && Date.now() - cache.at < 30_000) return cache.model;
  try {
    cache = { at: Date.now(), model: (await getModels()).find(hasCodexRole) ?? null };
  } catch {
    cache = { at: Date.now(), model: cache?.model ?? null };
  }
  return cache.model;
}

export function createModelCaller(): ModelCaller {
  return async ({ role, system, prompt, maxTokens }) => {
    const cfg = (await codexModel()) ?? (await getModelForRole(role));
    const raw = await callModel({
      system,
      userContent: prompt,
      maxTokens,
      modelId: cfg?.modelId,
      baseUrl: cfg?.baseUrl || undefined,
      apiKey: cfg?.apiKey || undefined,
      modelMaxTokens: cfg?.maxTokens,
      modelMaxReasoningTokens: cfg?.maxReasoningTokens,
    });
    try {
      return { json: extractModelJson(raw), model: cfg?.modelId ?? "default" };
    } catch (e) {
      throw new UnparseableOutput(e instanceof Error ? e.message : "unparseable model output");
    }
  };
}
