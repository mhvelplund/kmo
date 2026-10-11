import { describe, expect, it } from "vitest";
import { GuardedWatch, guardWanted, isEstablished, type GuardedKind, type WatchBinding } from "../src/guarded-kind";

const binding = {} as WatchBinding;
const widget: GuardedKind = { kind: "Widget", definition: "widgets.example.com", setting: "GUARD_WIDGET" };

/** A stand-in for starting a watch that records what happened to it. */
function fakeStarter() {
  const log: string[] = [];
  let giveUp = () => {};
  const start = async (_binding: WatchBinding, onGiveUp: () => void) => {
    log.push("started");
    giveUp = onGiveUp;
    return { close: () => log.push("closed") };
  };
  return { log, start, giveUp: () => giveUp() };
}

describe("the guard setting", () => {
  it("is on when nothing is set", () => {
    expect(guardWanted(widget, {})).toBe(true);
  });

  it("is off only for the value false", () => {
    expect(guardWanted(widget, { GUARD_WIDGET: "false" })).toBe(false);
    expect(guardWanted(widget, { GUARD_WIDGET: "no" })).toBe(true);
  });

  it("listens only to the kind's own variable", () => {
    expect(guardWanted(widget, { GUARD_GADGET: "false" })).toBe(true);
  });

  it("is off while Pepr builds the module, so the permissions for the kind are still generated", () => {
    expect(guardWanted(widget, { PEPR_MODE: "build" })).toBe(false);
  });
});

describe("a definition", () => {
  it("is established when the API server says so", () => {
    expect(isEstablished({ status: { conditions: [{ type: "Established", status: "True" }] } })).toBe(true);
  });

  it("is not established while it is still being set up", () => {
    expect(isEstablished({})).toBe(false);
    expect(isEstablished({ status: { conditions: [{ type: "Established", status: "False" }] } })).toBe(false);
  });
});

describe("a guarded watch", () => {
  it("starts once, however often the definition is seen", async () => {
    const { log, start } = fakeStarter();
    const guarded = new GuardedWatch("Widget", [binding], start);
    await guarded.ensureStarted();
    await guarded.ensureStarted();
    expect(log).toEqual(["started"]);
    expect(guarded.running).toBe(true);
  });

  it("stops when the definition is removed, and starts again when it comes back", async () => {
    const { log, start } = fakeStarter();
    const guarded = new GuardedWatch("Widget", [binding], start);
    await guarded.ensureStarted();
    guarded.stop();
    expect(guarded.running).toBe(false);
    await guarded.ensureStarted();
    expect(log).toEqual(["started", "closed", "started"]);
  });

  it("stops itself when the client gives up, instead of ending the process", async () => {
    const { log, start, giveUp } = fakeStarter();
    const guarded = new GuardedWatch("Widget", [binding], start);
    await guarded.ensureStarted();
    giveUp();
    expect(log).toEqual(["started", "closed"]);
    expect(guarded.running).toBe(false);
  });

  it("does nothing when there is no watch to guard", async () => {
    const { log, start } = fakeStarter();
    const guarded = new GuardedWatch("Widget", [], start);
    await guarded.ensureStarted();
    expect(log).toEqual([]);
  });
});
