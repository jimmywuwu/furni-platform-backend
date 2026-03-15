export class D1Client {
  constructor(private readonly db: D1Database) {}

  async all<T>(sql: string, ...params: D1Value[]): Promise<T[]> {
    const result = await this.db.prepare(sql).bind(...params).all<T>();
    return result.results ?? [];
  }

  async first<T>(sql: string, ...params: D1Value[]): Promise<T | null> {
    return this.db.prepare(sql).bind(...params).first<T>();
  }

  async run(sql: string, ...params: D1Value[]): Promise<D1RunResult> {
    return this.db.prepare(sql).bind(...params).run();
  }

  async batch(statements: Array<{ sql: string; params?: D1Value[] }>): Promise<void> {
    await this.db.batch(
      statements.map((statement) =>
        this.db.prepare(statement.sql).bind(...(statement.params ?? [])),
      ),
    );
  }
}

export function lastRowId(result: D1RunResult): number {
  const id = result.meta?.last_row_id;
  if (typeof id !== "number") {
    throw new Error("Insert did not return last_row_id");
  }
  return id;
}

export function toNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim()) {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

export function toBoolean(value: unknown): boolean {
  return Number(value ?? 0) === 1;
}

export function toText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
