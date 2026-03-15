type D1Value = ArrayBuffer | string | number | null;

interface D1Meta {
  last_row_id?: number;
}

interface D1RunResult {
  success: boolean;
  meta?: D1Meta;
}

interface D1AllResult<T> {
  results: T[];
  success: boolean;
  meta?: D1Meta;
}

interface D1PreparedStatement {
  bind(...values: D1Value[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(columnName?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1AllResult<T>>;
  run(): Promise<D1RunResult>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<T[]>;
  exec(query: string): Promise<unknown>;
}

interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}
