export class GoogleIntegrationError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 409) {
    super(message);
    this.name = "GoogleIntegrationError";
    this.code = code;
    this.status = status;
  }
}

export function mapGoogleIntegrationError(error: unknown, fallbackMessage: string) {
  if (error instanceof GoogleIntegrationError) {
    return {
      body: { error: error.message, code: error.code },
      status: error.status,
    };
  }
  return {
    body: { error: fallbackMessage },
    status: 503,
  };
}
