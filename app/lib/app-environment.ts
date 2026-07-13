export type AppEnvironment = "development" | "production";

export function resolveAppEnvironment(value: string | undefined): AppEnvironment {
  return value?.trim().toLowerCase() === "production" ? "production" : "development";
}
