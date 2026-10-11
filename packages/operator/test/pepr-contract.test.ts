import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.PEPR_WATCH_MODE = "true";
});

import { WatchEvent, WatchPhase } from "kubernetes-fluent-client";
import { Capability, RegisterKind, a, kind } from "pepr";
import { guardKind, takeWatchBindings, type GuardedKind } from "../src/guarded-kind";

/** Versions the shim was last proven against, on the cluster, with `mise run check:rollout-guard`. */
const VERIFIED = { pepr: "2.0.3", "kubernetes-fluent-client": "3.12.3" };

const require = createRequire(import.meta.url);

function installedVersion(name: string): string {
  return JSON.parse(readFileSync(require.resolve(`${name}/package.json`), "utf8")).version;
}

class Probe extends kind.GenericKind {}
RegisterKind(Probe, { group: "contract.kmo.isntall.net", version: "v1", kind: "Probe", plural: "probes" });

/** A capability with a watch on Probe between two watches on ConfigMaps. */
function capabilityWithWatches(seen: string[] = []) {
  const capability = new Capability({ name: "contract", description: "contract tests", namespaces: [] });
  capability
    .When(a.ConfigMap)
    .IsCreatedOrUpdated()
    .Watch(() => undefined);
  capability
    .When(Probe)
    .IsCreatedOrUpdated()
    .Watch((probe) => {
      seen.push(probe.metadata?.name ?? "");
    });
  capability
    .When(a.ConfigMap)
    .IsDeleted()
    .Watch(() => undefined);
  return capability;
}

describe("the versions the Rollout shim was verified against", () => {
  it.each(Object.entries(VERIFIED))(
    "%s is still %s; after an upgrade follow docs/upgrading-pepr.md before you change this number",
    (name, version) => {
      expect(installedVersion(name)).toBe(version);
    },
  );
});

describe("what the Rollout shim relies on in Pepr", () => {
  it("lists a declared watch as a binding that names its kind and model", () => {
    const binding = capabilityWithWatches().bindings[1];
    expect(binding).toMatchObject({
      isWatch: true,
      kind: { group: "contract.kmo.isntall.net", version: "v1", kind: "Probe" },
    });
    expect(binding?.model).toBe(Probe);
  });

  it("keeps the declared callback on the binding, callable with an object and a phase", async () => {
    const seen: string[] = [];
    const binding = capabilityWithWatches(seen).bindings[1];
    await binding?.watchCallback?.({ metadata: { name: "one" } }, WatchPhase.Added);
    expect(seen).toEqual(["one"]);
  });

  it("hands out its live list, so a binding that is taken out stays out", () => {
    const capability = capabilityWithWatches();
    const taken = takeWatchBindings(capability, "Probe");
    expect(taken.map((binding) => binding.kind.kind)).toEqual(["Probe"]);
    expect(capability.bindings.map((binding) => binding.kind.kind)).toEqual(["ConfigMap", "ConfigMap"]);
  });

  it("leaves the other bindings as they were", () => {
    const capability = capabilityWithWatches();
    const before = capability.bindings.filter((binding) => binding.kind.kind === "ConfigMap");
    takeWatchBindings(capability, "Probe");
    expect(capability.bindings).toEqual(before);
  });
});

describe("guarding a kind", () => {
  const probe: GuardedKind = {
    kind: "Probe",
    definition: "probes.contract.kmo.isntall.net",
    setting: "GUARD_PROBE",
  };

  it("takes the kind's watch away from Pepr and watches its definition by name instead", () => {
    const capability = capabilityWithWatches();
    guardKind(capability, probe, {});
    expect(capability.bindings.map((binding) => [binding.kind.kind, binding.filters.name])).toEqual([
      ["ConfigMap", ""],
      ["ConfigMap", ""],
      ["CustomResourceDefinition", probe.definition],
      ["CustomResourceDefinition", probe.definition],
    ]);
  });

  it("leaves everything to Pepr when the setting is false", () => {
    const capability = capabilityWithWatches();
    expect(guardKind(capability, probe, { GUARD_PROBE: "false" })).toBeUndefined();
    expect(capability.bindings.map((binding) => binding.kind.kind)).toEqual(["ConfigMap", "Probe", "ConfigMap"]);
  });
});

describe("what the Rollout shim relies on in the client", () => {
  it("names the event it sends when a watch cannot be kept alive", () => {
    expect(WatchEvent.GIVE_UP).toBe("give_up");
  });
});
