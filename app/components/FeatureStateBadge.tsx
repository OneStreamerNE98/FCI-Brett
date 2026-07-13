export type FeatureState = "Working" | "Pilot" | "Setup required" | "Planned";

const featureStateDescriptions: Record<FeatureState, string> = {
  Working: "Available with durable pilot records",
  Pilot: "Available for controlled test-data use",
  "Setup required": "Available after the required connection or configuration is completed",
  Planned: "Informational only; the workflow is not implemented yet",
};

export function FeatureStateBadge({ state }: { state: FeatureState }) {
  const className = state.toLowerCase().replaceAll(" ", "-");
  return <span className={`feature-state feature-state-${className}`} title={featureStateDescriptions[state]}>{state}</span>;
}
