import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { requireOfficeUser, requireSameOrigin } from "../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../_workspace-data";

async function hasAllowedContentSignature(file: File) {
  const bytes = new Uint8Array(await file.slice(0, 512).arrayBuffer());
  const startsWith = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  if (file.type === "image/jpeg") return startsWith(0xff, 0xd8, 0xff);
  if (file.type === "image/png") return startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  if (file.type === "image/webp") return startsWith(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  if (file.type === "application/pdf") return startsWith(0x25, 0x50, 0x44, 0x46, 0x2d);
  if (file.type === "text/plain") return !bytes.includes(0);
  return false;
}

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "file is required" }, { status: 400 });
  if (file.size > 20 * 1024 * 1024) return NextResponse.json({ error: "file exceeds 20 MB limit" }, { status: 413 });
  const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf", "text/plain"];
  if (!allowed.includes(file.type)) return NextResponse.json({ error: "file type is not allowed" }, { status: 415 });
  if (!await hasAllowedContentSignature(file)) return NextResponse.json({ error: "file contents do not match the declared type" }, { status: 415 });
  const projectId = typeof form.get("projectId") === "string" ? String(form.get("projectId")).trim() : "";
  if (projectId) {
    const project = await env.DB.prepare("SELECT id FROM projects WHERE id = ?").bind(projectId).first();
    if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });
  }
  const key = `${projectId || "unassigned"}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
  await env.FILES.put(key, file.stream(), { httpMetadata: { contentType: file.type }, customMetadata: { originalName: file.name, uploadedBy: auth.user.email } });
  return NextResponse.json({ key, name: file.name, size: file.size }, { status: 201 });
}
