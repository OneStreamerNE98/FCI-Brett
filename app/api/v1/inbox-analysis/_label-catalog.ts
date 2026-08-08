import { createD1AssistantLabelRepository } from "../../../adapters/d1/assistant-label-repository";
import type { D1Database } from "../../../adapters/d1/d1-database";
import {
  inboxAnalysisLabelDefinitionVersion,
  type InboxAnalysisLabelDefinition,
} from "../../../application/assistant/inbox-analysis";

export type AssistantLabelCatalog = Readonly<{
  definitions: readonly InboxAnalysisLabelDefinition[];
  labels: readonly Readonly<{
    slug: string;
    description: string;
    retired: boolean;
  }>[];
  knownSlugs: ReadonlySet<string>;
  version: string;
}>;

/** Active definitions drive new classifications; retired labels stay in the
 * historical catalog so saved outcomes never lose their human meaning. */
export async function readAssistantLabelCatalog(
  database: D1Database,
): Promise<AssistantLabelCatalog> {
  const rows = await createD1AssistantLabelRepository(database).list();
  const definitions = Object.freeze(rows
    .filter(({ retired }) => !retired)
    .map(({ slug, description }) => Object.freeze({ slug, description })));
  const labels = Object.freeze(rows.map(({ slug, description, retired }) =>
    Object.freeze({ slug, description, retired })
  ));
  return Object.freeze({
    definitions,
    labels,
    knownSlugs: new Set(labels.map(({ slug }) => slug)),
    version: inboxAnalysisLabelDefinitionVersion(definitions),
  });
}
