export type FeatureState = "Working" | "In development" | "Setup required" | "Planned";

const featureStateDescriptions: Record<FeatureState, string> = {
  Working: "Available with durable saved records",
  "In development": "Available for development and test-data validation",
  "Setup required": "Available after the required connection or configuration is completed",
  Planned: "Informational only; the workflow is not implemented yet",
};

const featureStateCompactLabels: Record<FeatureState, string> = {
  Working: "Working",
  "In development": "Dev",
  "Setup required": "Setup",
  Planned: "Planned",
};

export function FeatureStateBadge({ state }: { state: FeatureState }) {
  const className = state.toLowerCase().replaceAll(" ", "-");
  return <span className={`feature-state feature-state-${className}`} data-compact-label={featureStateCompactLabels[state]} title={featureStateDescriptions[state]}>{state}</span>;
}
