import { GoogleIntegrationError } from "./google-integration-error";
import {
  sanitizeWorkspaceBlueprint,
  WorkspaceBlueprintValidationError,
  type WorkspaceBlueprint,
} from "./workspace-blueprint";

/**
 * Re-applies write-strength validation immediately before a blueprint can plan
 * or create Drive folders. Reads deliberately widen legacy sibling-name
 * duplicates so an administrator can still open Settings and repair them; an
 * action must fail closed before the first provider or persistence mutation.
 */
export function assertProvisionableWorkspaceBlueprint(
  blueprint: WorkspaceBlueprint,
): WorkspaceBlueprint {
  try {
    return sanitizeWorkspaceBlueprint(blueprint);
  } catch (error) {
    if (error instanceof WorkspaceBlueprintValidationError) {
      throw new GoogleIntegrationError(
        "drive_folder_identity_conflict",
        `The workspace blueprint cannot provision Drive folders: ${error.message} Rename duplicate sibling folders in Settings before retrying.`,
        409,
      );
    }
    throw error;
  }
}
