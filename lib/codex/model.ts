// The model Codex uses is the one attached in Mastery's Admin → Settings: the "generation" role writes
// plans and questions, the "audit" role solves blind and reviews. Both go through Mastery's callModel.

import { callModel, getModelForRole } from "../model";
import { extractModelJson } from "../parse";
import { UnparseableOutput } from "./engine";
import type { ModelCaller } from "./engine";

export function createModelCaller(): ModelCaller {
  return async ({ role, system, prompt, maxTokens }) => {
    const cfg = await getModelForRole(role);
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
