import { describe, expect, it } from "vitest";
import { DotenvParseError, parseDotenv } from "../src/dotenv";

/** Parses text that must be rejected and returns the error. */
function rejection(text: string): DotenvParseError {
  try {
    parseDotenv(text);
  } catch (error) {
    if (error instanceof DotenvParseError) return error;
    throw error;
  }
  throw new Error("expected the file to be rejected");
}

describe("an env file", () => {
  it("gives one value per KEY=value line", () => {
    expect(parseDotenv("GREETING=hello\nLOG_LEVEL=debug\n")).toEqual({ GREETING: "hello", LOG_LEVEL: "debug" });
  });

  it("may be empty", () => {
    expect(parseDotenv("")).toEqual({});
  });

  it("skips blank lines and comment lines", () => {
    expect(parseDotenv("# settings\n\nGREETING=hello\n   # indented comment\n")).toEqual({ GREETING: "hello" });
  });

  it("ignores spaces around the key and the value", () => {
    expect(parseDotenv("  NAME = orders  ")).toEqual({ NAME: "orders" });
  });

  it("allows an empty value", () => {
    expect(parseDotenv("EMPTY=\nALSO_EMPTY= # nothing here")).toEqual({ EMPTY: "", ALSO_EMPTY: "" });
  });

  it("keeps everything after the first equals sign", () => {
    expect(parseDotenv("DATABASE_URL=postgres://u:p@db/shop?sslmode=require\nTOKEN=YWJj==")).toEqual({
      DATABASE_URL: "postgres://u:p@db/shop?sslmode=require",
      TOKEN: "YWJj==",
    });
  });

  it("treats # as a comment only after whitespace", () => {
    expect(parseDotenv("PORT=8080 # http\nCOLOR=#ff0000\nPASSWORD=p#ss")).toEqual({
      PORT: "8080",
      COLOR: "#ff0000",
      PASSWORD: "p#ss",
    });
  });

  it('keeps spaces and # inside double quotes, and expands \\n and \\"', () => {
    expect(parseDotenv('MOTTO=" keep # calm "\nLINES="one\\ntwo"\nQUOTE="she said \\"hi\\"" # note')).toEqual({
      MOTTO: " keep # calm ",
      LINES: "one\ntwo",
      QUOTE: 'she said "hi"',
    });
  });

  it("holds a certificate on one line, with \\n for each line break", () => {
    const line = 'TLS_CERT="-----BEGIN CERTIFICATE-----\\nMIIBszCCAVmg\\n-----END CERTIFICATE-----"';
    expect(parseDotenv(line)).toEqual({
      TLS_CERT: "-----BEGIN CERTIFICATE-----\nMIIBszCCAVmg\n-----END CERTIFICATE-----",
    });
  });

  it("takes single-quoted values literally", () => {
    expect(parseDotenv("RAW='one\\ntwo # not a comment'")).toEqual({ RAW: "one\\ntwo # not a comment" });
  });

  it("does not expand variables", () => {
    expect(parseDotenv("URL=http://$HOST/${PATH}")).toEqual({ URL: "http://$HOST/${PATH}" });
  });

  it("lets the last of two identical keys win", () => {
    expect(parseDotenv("LEVEL=info\nLEVEL=debug")).toEqual({ LEVEL: "debug" });
  });

  it("reads a file saved on Windows the same way", () => {
    expect(parseDotenv("\uFEFFGREETING=hello\r\nLOG_LEVEL=debug\r\n")).toEqual({
      GREETING: "hello",
      LOG_LEVEL: "debug",
    });
  });
});

describe("an env file that cannot be parsed", () => {
  it("is rejected with the number of the offending line", () => {
    expect(rejection("GREETING=hello\nthis is not a setting").line).toBe(2);
  });

  it.each(["1ST=x", "MY-KEY=x", "=x", "export NAME=x"])("is rejected when a key is not a variable name: %s", (text) => {
    expect(rejection(text).reason).toBe("key is not a valid environment variable name");
  });

  it("is rejected when a quote is never closed", () => {
    expect(rejection('GREETING="hello').reason).toBe("quoted value is not closed");
  });

  it("is rejected when text follows a closing quote", () => {
    expect(rejection('GREETING="hello" there').reason).toBe("unexpected text after closing quote");
  });

  it("never repeats a value in its message, since values may be secrets", () => {
    expect(rejection('USER=admin\nPASSWORD="hunter2').message).toBe("line 2: quoted value is not closed");
  });
});
