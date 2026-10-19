// Serialize/deserialize helpers for fields stored as JSON strings.
// SQLite has no native JSON column type in this Prisma version, so flexible
// fields are stored as TEXT and parsed in the application layer.

export function toJsonString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

export function fromJsonString<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
