export interface PilotD1PreparedStatement {
  bind(...values: unknown[]): PilotD1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

export type PilotD1BatchResult = {
  meta: {
    changes?: number;
  };
};

export interface PilotD1Database {
  prepare(query: string): PilotD1PreparedStatement;
  batch(statements: PilotD1PreparedStatement[]): Promise<PilotD1BatchResult[]>;
}
