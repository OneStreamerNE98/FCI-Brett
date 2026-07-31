const BUILD_COMMIT_ENVIRONMENT_NAME = "FCI_BUILD_COMMIT_SHA";
const BUILD_TIMESTAMP_ENVIRONMENT_NAME = "FCI_BUILD_TIMESTAMP";
const COMMIT_SHA_PATTERN = /^[0-9a-f]{7,40}$/iu;
const UTC_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u;

/**
 * Read and validate the deployment identity that Vite will bake into the app.
 *
 * Both values are intentionally all-or-nothing. A local build with neither
 * value has no deployment identity; a partial or malformed identity stops the
 * build instead of emitting something that looks authoritative.
 *
 * @param {NodeJS.ProcessEnv} environment
 * @returns {{ commitSha: string; builtAt: string } | null}
 */
export function readBuildInformation(environment) {
  const commitSha = environment[BUILD_COMMIT_ENVIRONMENT_NAME]?.trim() ?? "";
  const builtAt = environment[BUILD_TIMESTAMP_ENVIRONMENT_NAME]?.trim() ?? "";

  if (!commitSha && !builtAt) return null;

  if (!commitSha || !builtAt) {
    throw new Error(
      `${BUILD_COMMIT_ENVIRONMENT_NAME} and ${BUILD_TIMESTAMP_ENVIRONMENT_NAME} must be supplied together.`,
    );
  }
  if (!COMMIT_SHA_PATTERN.test(commitSha)) {
    throw new Error(
      `${BUILD_COMMIT_ENVIRONMENT_NAME} must be a 7-to-40 character hexadecimal Git commit SHA.`,
    );
  }
  if (
    !UTC_TIMESTAMP_PATTERN.test(builtAt) ||
    Number.isNaN(Date.parse(builtAt)) ||
    new Date(builtAt).toISOString() !==
      builtAt.replace(
        /(?:\.(\d{1,3}))?Z$/u,
        (_match, fraction = "") => `.${fraction.padEnd(3, "0")}Z`,
      )
  ) {
    throw new Error(
      `${BUILD_TIMESTAMP_ENVIRONMENT_NAME} must be an ISO 8601 UTC timestamp.`,
    );
  }

  return {
    commitSha: commitSha.toLowerCase().slice(0, 7),
    builtAt,
  };
}
