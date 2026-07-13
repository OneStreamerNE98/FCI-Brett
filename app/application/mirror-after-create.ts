import type { DirectoryMirror, DirectoryMirrorRequest, DirectoryMirrorResult } from "../ports/directory-mirror";

const FAILED_MIRROR_MESSAGE = "Saved in FCI Operations; Google Sheet sync needs attention: the directory mirror request did not complete.";

export async function mirrorAfterDurableCreate(mirror: DirectoryMirror, request: DirectoryMirrorRequest): Promise<DirectoryMirrorResult> {
  try {
    return await mirror.requestSync(request);
  } catch {
    return {
      status: "pending",
      message: FAILED_MIRROR_MESSAGE,
      error: {
        code: "directory_mirror_failed",
        message: "The optional directory mirror request did not complete; the FCI Operations record is saved.",
      },
    };
  }
}
