const DURATION = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/;

/** Raised when a ConfigSync spec holds a value that cannot be used. */
export class ConfigSyncSpecError extends Error {
  /** @param message What is wrong with the spec. */
  constructor(message: string) {
    super(message);
    this.name = "ConfigSyncSpecError";
  }
}

/**
 * Parses a duration made of hours, minutes and seconds, such as 30m or 1h30m.
 * @param text The duration as written in a spec.
 * @returns The duration in milliseconds.
 * @throws ConfigSyncSpecError if the text is not a duration.
 */
export function parseDuration(text: string): number {
  const match = DURATION.exec(text);
  if (!match || text === "") throw new ConfigSyncSpecError(`"${text}" is not a duration such as 30m or 1h30m`);
  const [, hours = "0", minutes = "0", seconds = "0"] = match;
  return ((Number(hours) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000;
}
