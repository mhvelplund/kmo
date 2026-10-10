import { describe, expect, it } from "vitest";
import { configHash } from "../src/hash";

describe("the config hash", () => {
  it("is the same whatever order the keys are in", () => {
    expect(configHash({ A: "1", B: "2" }, { X: "9" })).toBe(configHash({ B: "2", A: "1" }, { X: "9" }));
  });

  it("changes when a value changes", () => {
    expect(configHash({ A: "1" }, {})).not.toBe(configHash({ A: "2" }, {}));
  });

  it("changes when a key moves between the ConfigMap and the Secret", () => {
    expect(configHash({ A: "1" }, {})).not.toBe(configHash({}, { A: "1" }));
  });

  it("tells one value containing a line break from two separate keys", () => {
    expect(configHash({ A: "1\nB=2" }, {})).not.toBe(configHash({ A: "1", B: "2" }, {}));
  });

  it("is a SHA-256 digest in hex", () => {
    expect(configHash({}, {})).toMatch(/^[0-9a-f]{64}$/);
  });
});
