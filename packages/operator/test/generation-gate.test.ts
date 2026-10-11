import { describe, expect, it } from "vitest";
import { GenerationGate } from "../src/generation-gate";

const object = (generation: number, uid = "uid-1") => ({ metadata: { uid, generation } });

describe("the generation gate", () => {
  it("lets an object through the first time it is seen", () => {
    expect(new GenerationGate().changed(object(1))).toBe(true);
  });

  it("stops an update that left the spec as it was, such as a status update", () => {
    const gate = new GenerationGate();
    gate.changed(object(1));
    expect(gate.changed(object(1))).toBe(false);
  });

  it("lets an object through again when its spec changed", () => {
    const gate = new GenerationGate();
    gate.changed(object(1));
    expect(gate.changed(object(2))).toBe(true);
  });

  it("tells objects apart", () => {
    const gate = new GenerationGate();
    gate.changed(object(1, "uid-1"));
    expect(gate.changed(object(1, "uid-2"))).toBe(true);
  });

  it("forgets an object that was deleted", () => {
    const gate = new GenerationGate();
    gate.changed(object(1));
    gate.forget(object(1));
    expect(gate.changed(object(1))).toBe(true);
  });
});
