import type { AssistantLabelDefinition } from "../domain/assistant-label-definition";

/** "protected" is the migration-seeded system slugs: they carry the typed
 * accepts, so no adapter may delete or retire them. */
export type AssistantLabelRemovalOutcome =
  | "deleted"
  | "retired"
  | "not-found"
  | "protected";

/** The active cap and the total-row bound fail differently and the caller must
 * tell them apart: an active cap clears when a label is retired, an exhausted
 * store never does. */
export type AssistantLabelInsertOutcome =
  | "inserted"
  | "active-cap-reached"
  | "storage-exhausted"
  | "not-inserted";

export interface AssistantLabelRepository {
  list(): Promise<AssistantLabelDefinition[]>;
  insert(label: AssistantLabelDefinition): Promise<AssistantLabelInsertOutcome>;
  updateDescription(
    slug: string,
    description: string,
    updatedAt: number,
  ): Promise<boolean>;
  removeOrRetire(
    slug: string,
    updatedAt: number,
  ): Promise<AssistantLabelRemovalOutcome>;
}
