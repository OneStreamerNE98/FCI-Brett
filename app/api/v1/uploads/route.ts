import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "file is required" }, { status: 400 });
  if (file.size > 20 * 1024 * 1024) return NextResponse.json({ error: "file exceeds 20 MB limit" }, { status: 413 });
  const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf", "text/plain"];
  if (!allowed.includes(file.type)) return NextResponse.json({ error: "file type is not allowed" }, { status: 415 });
  const key = `${form.get("projectId") ?? "unassigned"}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
  await env.FILES.put(key, file.stream(), { httpMetadata: { contentType: file.type }, customMetadata: { originalName: file.name } });
  return NextResponse.json({ key, name: file.name, size: file.size }, { status: 201 });
}
