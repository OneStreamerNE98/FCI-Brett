export default class RetryOnlyPassReporter {
  retryOnlyPasses = [];

  onTestEnd(test, result) {
    if (result.status !== "passed" || result.retry === 0) return;

    const title = test.titlePath().join(" › ");
    this.retryOnlyPasses.push({ retry: result.retry, title });
    process.stderr.write(
      `[playwright-retry-only-pass] ${title} passed on retry ${result.retry}; treating the run as failed.\n`,
    );
  }

  onEnd() {
    if (this.retryOnlyPasses.length === 0) return;

    process.stderr.write(
      `[playwright-retry-only-pass] ${this.retryOnlyPasses.length} retry-only pass${this.retryOnlyPasses.length === 1 ? "" : "es"} surfaced.\n`,
    );
    return { status: "failed" };
  }
}
