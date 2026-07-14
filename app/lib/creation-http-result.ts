import type { CreateClientResult } from "../application/create-client";
import type { CreateProjectResult } from "../application/create-project";

const CLIENT_FAILURE_STATUS = {
  forbidden: 403,
  invalid: 400,
  duplicate: 409,
  "identifier-collision": 503,
  "idempotency-conflict": 409,
  "in-progress": 409,
} as const satisfies Record<Extract<CreateClientResult, { ok: false }>["kind"], number>;

const PROJECT_FAILURE_STATUS = {
  forbidden: 403,
  invalid: 400,
  "project-manager-not-authorized": 400,
  "client-not-found": 404,
  "identifier-collision": 503,
  "idempotency-conflict": 409,
  "in-progress": 409,
} as const satisfies Record<Extract<CreateProjectResult, { ok: false }>["kind"], number>;

/** Keeps the portable result-to-HTTP contract explicit and independently testable. */
export function clientCreationHttpResult(result: CreateClientResult) {
  if (result.ok) return { status: 201 as const, body: result.value };
  return {
    status: CLIENT_FAILURE_STATUS[result.kind],
    body: { error: result.message },
  };
}

/** Keeps the portable result-to-HTTP contract explicit and independently testable. */
export function projectCreationHttpResult(result: CreateProjectResult) {
  if (result.ok) return { status: 201 as const, body: result.value };
  return {
    status: PROJECT_FAILURE_STATUS[result.kind],
    body: { error: result.message },
  };
}
