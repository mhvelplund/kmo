import type { EnvValues } from "./types";

const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ESCAPES: Record<string, string> = { n: "\n", r: "\r", t: "\t" };

/** Raised when an env file cannot be parsed. Carries the line number and a reason, never a value. */
export class DotenvParseError extends Error {
  /**
   * @param line One-based number of the offending line.
   * @param reason What is wrong with it.
   */
  constructor(
    readonly line: number,
    readonly reason: string,
  ) {
    super(`line ${line}: ${reason}`);
    this.name = "DotenvParseError";
  }
}

/**
 * Parses the text of an env file.
 * @param text File contents.
 * @returns The key-value pairs, the last occurrence of a key winning.
 * @throws DotenvParseError on the first line that is not blank, a comment or a valid assignment.
 */
export function parseDotenv(text: string): EnvValues {
  const values: EnvValues = {};
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) return;
    const equals = line.indexOf("=");
    if (equals === -1) throw new DotenvParseError(index + 1, "expected KEY=value");
    const key = line.slice(0, equals).trimEnd();
    if (!KEY.test(key)) throw new DotenvParseError(index + 1, "key is not a valid environment variable name");
    values[key] = parseValue(line.slice(equals + 1), index + 1);
  });
  return values;
}

function parseValue(afterEquals: string, line: number): string {
  const rest = afterEquals.trimStart();
  const quote = rest[0];
  if (quote !== '"' && quote !== "'") return afterEquals.replace(/\s#.*$/, "").trim();

  const close = closingQuote(rest, quote);
  if (close === -1) throw new DotenvParseError(line, "quoted value is not closed");
  const trailing = rest.slice(close + 1).trim();
  if (trailing !== "" && !trailing.startsWith("#")) {
    throw new DotenvParseError(line, "unexpected text after closing quote");
  }
  const body = rest.slice(1, close);
  return quote === "'" ? body : body.replace(/\\(.)/g, (_, char: string) => ESCAPES[char] ?? char);
}

function closingQuote(text: string, quote: string): number {
  for (let i = 1; i < text.length; i++) {
    if (quote === '"' && text[i] === "\\") i++;
    else if (text[i] === quote) return i;
  }
  return -1;
}
