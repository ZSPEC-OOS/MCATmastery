import { NextRequest, NextResponse } from "next/server";
import { getModels, saveModel, updateModelRole, updateModel, deleteModel } from "../../../../lib/firestore";

const KNOWN_ROLES = new Set(["generation", "audit", "formatting", "codex", "both", "disabled"]);

function isValidRole(role: unknown): role is string {
  if (typeof role !== "string" || !role) return false;
  if (role === "disabled") return true;
  return role.split(",").every(r => KNOWN_ROLES.has(r.trim()));
}

export async function GET() {
  try {
    const models = await getModels();
    return NextResponse.json({ models });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to fetch models";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, unknown>;
    const { name, modelId, baseUrl, apiKey, role, maxTokens, maxReasoningTokens } = body as { name?: string; modelId?: string; baseUrl?: string; apiKey?: string; role?: string; maxTokens?: number; maxReasoningTokens?: number };
    if (!name?.trim() || !modelId?.trim()) {
      return NextResponse.json({ error: "name and modelId are required" }, { status: 400 });
    }
    const resolvedRole = isValidRole(role) ? role : "generation,audit";
    const model = await saveModel({
      name: name.trim(), modelId: modelId.trim(), baseUrl: baseUrl?.trim() ?? "", apiKey: apiKey?.trim() ?? "", role: resolvedRole,
      ...(maxTokens !== undefined && Number.isFinite(maxTokens) ? { maxTokens: Math.round(maxTokens) } : {}),
      ...(maxReasoningTokens && Number.isFinite(maxReasoningTokens) ? { maxReasoningTokens: Math.round(maxReasoningTokens) } : {}),
    });
    return NextResponse.json({ model });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json() as { id: string; role?: string; name?: string; modelId?: string; baseUrl?: string; apiKey?: string; maxTokens?: number; maxReasoningTokens?: number };
    const { id, role, name, modelId, baseUrl, apiKey, maxTokens, maxReasoningTokens } = body;
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    // Full model update when name/modelId are provided
    if (name !== undefined || modelId !== undefined || baseUrl !== undefined || apiKey !== undefined) {
      if (!name?.trim() || !modelId?.trim()) {
        return NextResponse.json({ error: "name and modelId are required" }, { status: 400 });
      }
      const fields: Record<string, unknown> = { name: name.trim(), modelId: modelId.trim(), baseUrl: baseUrl?.trim() ?? "", apiKey: apiKey?.trim() ?? "" };
      if (maxTokens !== undefined) fields.maxTokens = Number.isFinite(maxTokens) ? Math.round(maxTokens) : null;
      if (maxReasoningTokens !== undefined) fields.maxReasoningTokens = (maxReasoningTokens && Number.isFinite(maxReasoningTokens)) ? Math.round(maxReasoningTokens) : null;
      if (role !== undefined) {
        if (!isValidRole(role)) return NextResponse.json({ error: "invalid role" }, { status: 400 });
        fields.role = role;
      }
      await updateModel(id, fields as Parameters<typeof updateModel>[1]);
      return NextResponse.json({ success: true });
    }

    // Role-only update
    if (!isValidRole(role ?? "")) {
      return NextResponse.json({ error: "invalid role" }, { status: 400 });
    }
    await updateModelRole(id, role!);
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json() as { id: string };
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    await deleteModel(id);
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed";
    return NextResponse.json({ error: msg.startsWith("Firebase") ? msg : "Failed to delete model" }, { status: 500 });
  }
}
