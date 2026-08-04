import type { AssistantLabelDefinition } from "../domain/assistant-label-definition";

export type AssistantLabelRemovalOutcome = "deleted" | "retired" | "not-found";

export interface AssistantLabelRepository {
  list(): Promise<AssistantLabelDefinition[]>;
  insert(label: AssistantLabelDefinition): Promise<boolean>;
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
