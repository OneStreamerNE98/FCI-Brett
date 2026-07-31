export type BuildInformation = {
  commitSha: string;
  builtAt: string;
};

declare const __FCI_BUILD_INFORMATION__: BuildInformation | null;

export const BUILD_INFORMATION =
  typeof __FCI_BUILD_INFORMATION__ === "undefined"
    ? null
    : __FCI_BUILD_INFORMATION__;
