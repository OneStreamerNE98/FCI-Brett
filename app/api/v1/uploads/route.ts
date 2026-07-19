import { env } from "cloudflare:workers";
import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { R2ObjectStorage } from "../../../adapters/r2/object-storage";
import { requireOfficeUser, requireSameOrigin } from "../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../_workspace-data";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_MULTIPART_BYTES = 22 * 1024 * 1024;

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

async function* uploadBody(bytes: Uint8Array) {
  if (bytes.byteLength > 0) yield bytes;
}

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\b/i.test(contentType) || !/;\s*boundary=(?:"[^"]+"|[^;\s]+)/i.test(contentType)) {
    return NextResponse.json({ error: "upload must be valid multipart form data with a boundary" }, { status: 400 });
  }
  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader !== null) {
    if (!/^\d+$/.test(contentLengthHeader)) {
      return NextResponse.json({ error: "content-length must be a non-negative integer" }, { status: 400 });
    }
    const declaredLength = Number(contentLengthHeader);
    if (!Number.isSafeInteger(declaredLength)) {
      return NextResponse.json({ error: "content-length must be a safe non-negative integer" }, { status: 400 });
    }
    if (declaredLength > MAX_MULTIPART_BYTES) {
      return NextResponse.json({ error: "upload request exceeds the multipart size limit" }, { status: 413 });
    }
  }
  await ensureWorkspaceSchema();
  let form: FormData | null = null;
  try {
    form = await request.formData();
  } catch {
    form = null;
  }
  if (!form) return NextResponse.json({ error: "upload must be valid multipart form data" }, { status: 400 });
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "file is required" }, { status: 400 });
  if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: "file exceeds 20 MB limit" }, { status: 413 });
  const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf", "text/plain"];
  if (!allowed.includes(file.type)) return NextResponse.json({ error: "file type is not allowed" }, { status: 415 });
  if (!await hasAllowedContentSignature(file)) return NextResponse.json({ error: "file contents do not match the declared type" }, { status: 415 });
  const projectId = typeof form.get("projectId") === "string" ? String(form.get("projectId")).trim() : "";
  if (projectId) {
    const project = await env.DB.prepare("SELECT id FROM projects WHERE id = ?").bind(projectId).first();
    if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });
  }
  const key = `${projectId || "unassigned"}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const storage = new R2ObjectStorage({
    bucket: env.FILES,
    customMetadata: { originalName: file.name, uploadedBy: auth.user.email },
  });
  const stored = await storage.putIfAbsent({
    key,
    contentType: file.type,
    byteSize: bytes.byteLength,
    sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    chunks: uploadBody(bytes),
  });
  if (stored.outcome === "already-exists") {
    return NextResponse.json({ error: "upload key already exists; retry the upload" }, { status: 409 });
  }
  return NextResponse.json({ key, name: file.name, size: file.size }, { status: 201 });
}
