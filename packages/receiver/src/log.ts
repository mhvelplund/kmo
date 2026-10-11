/** Writes one message with its fields. */
export type Log = (message: string, fields?: Record<string, unknown>) => void;

/**
 * Writes a message to the standard output as one line of JSON.
 * @param message What happened.
 * @param fields Details; never the token or a value from a file.
 */
export const log: Log = (message, fields = {}) => {
  console.log(JSON.stringify({ time: new Date().toISOString(), message, ...fields }));
};

/**
 * Names an error without repeating what it may hold.
 * @param error What was thrown.
 * @returns The error's name, with its HTTP status code when it has one.
 */
export function errorName(error: unknown): string {
  const { name, code } = (error ?? {}) as { name?: string; code?: unknown };
  return typeof code === "number" ? `${name ?? "Error"} ${code}` : (name ?? "unknown error");
}
