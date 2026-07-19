import { expect, test } from "@playwright/test";

const ORIGIN = "http://localhost:4173";

test("the guarded upload route stores an allowed project file through the R2 adapter", async ({ request }) => {
  const pdf = Buffer.from("%PDF-1.7\nFCI TEST — DO NOT USE\n", "utf8");
  const response = await request.post("/api/v1/uploads", {
    headers: { origin: ORIGIN },
    multipart: {
      projectId: "e2e-project-001",
      file: {
        name: "FCI TEST — DO NOT USE proposal.pdf",
        mimeType: "application/pdf",
        buffer: pdf,
      },
    },
  });

  expect(response.status()).toBe(201);
  const payload = await response.json();
  expect(payload).toMatchObject({
    name: "FCI TEST — DO NOT USE proposal.pdf",
    size: pdf.byteLength,
  });
  expect(payload.key).toMatch(
    /^e2e-project-001\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-FCI-TEST---DO-NOT-USE-proposal\.pdf$/,
  );
});

test("the upload route keeps magic-byte and project association failures closed", async ({ request }) => {
  const mismatched = await request.post("/api/v1/uploads", {
    headers: { origin: ORIGIN },
    multipart: {
      projectId: "e2e-project-001",
      file: {
        name: "FCI TEST — DO NOT USE mismatch.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("not a PDF", "utf8"),
      },
    },
  });
  expect(mismatched.status()).toBe(415);
  await expect(mismatched.json()).resolves.toEqual({ error: "file contents do not match the declared type" });

  const missingProject = await request.post("/api/v1/uploads", {
    headers: { origin: ORIGIN },
    multipart: {
      projectId: "missing-e2e-project",
      file: {
        name: "FCI TEST — DO NOT USE note.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("FCI TEST — DO NOT USE", "utf8"),
      },
    },
  });
  expect(missingProject.status()).toBe(404);
  await expect(missingProject.json()).resolves.toEqual({ error: "project not found" });
});
