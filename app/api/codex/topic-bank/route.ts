import { NextRequest, NextResponse } from "next/server";
import { errorResponse, getDeps, isDenied, requireCodexUser } from "../../../../lib/codex/runtime";

// GET ?subject=Biology → the major sections of that subject already saved in the topic database.
export async function GET(req: NextRequest) {
  const user = await requireCodexUser();
  if (isDenied(user)) return user;
  try {
    const subject = req.nextUrl.searchParams.get("subject");
    if (!subject) return NextResponse.json({ error: "subject is required" }, { status: 400 });
    const sections = await getDeps().bank.listSections(subject);
    return NextResponse.json({ sections: sections.map((s) => ({ number: s.number, id: s.sectionId, title: s.title, topics: s.topicCount, savedAt: s.savedAt, subsections: s.subsections.map((ss) => ({ id: ss.id, title: ss.title })) })) });
  } catch (e) {
    return errorResponse(e);
  }
}
