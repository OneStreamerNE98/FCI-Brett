export const MAJOR_VIEW_LOAD_TIMEOUT_MS = 15_000;

export function loadMajorViewWithDeadline<T>(
  view: string,
  importer: () => Promise<T>,
  timeoutMs = MAJOR_VIEW_LOAD_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      reject(new Error(`${view} could not be loaded within 15 seconds. Reload the page to try again.`));
    }, timeoutMs);
    void importer().then(resolve, reject).finally(() => globalThis.clearTimeout(timeout));
  });
}
