import { WatchEvent, WatchPhase } from "kubernetes-fluent-client";
import { K8s, Log, a, type Capability } from "pepr";

/** A kind that may be missing from the cluster, so KMO starts and stops its watches itself. */
export interface GuardedKind {
  /** Kind name, such as Rollout. */
  kind: string;
  /** Name of the definition that makes the kind exist, such as rollouts.argoproj.io. */
  definition: string;
  /** Environment variable that turns the guard off when it is "false". */
  setting: string;
}

/** One entry of a capability's list of bindings. */
export type WatchBinding = Capability["bindings"][number];

/** Something that can be closed, such as a running watch. */
interface Closable {
  close(): void;
}

/** Starts one watch and reports when the client gives up on it. */
type Starter = (binding: WatchBinding, onGiveUp: () => void) => Promise<Closable>;

/**
 * Tells whether the watches on a kind are taken out of Pepr's hands.
 * @param guarded The kind.
 * @param env The process environment.
 * @returns False when the kind's setting is "false" or Pepr is building the module.
 */
export function guardWanted(guarded: GuardedKind, env: NodeJS.ProcessEnv): boolean {
  return env[guarded.setting] !== "false" && env.PEPR_MODE !== "build";
}

/**
 * Removes the watches on one kind from a capability, so that Pepr does not start them.
 * @param capability The capability that declared them.
 * @param kindName The kind to take, such as Rollout.
 * @returns The removed bindings, in the order they were declared.
 */
export function takeWatchBindings(capability: Capability, kindName: string): WatchBinding[] {
  const bindings = capability.bindings;
  const taken: WatchBinding[] = [];
  for (let index = bindings.length - 1; index >= 0; index--) {
    const binding = bindings[index];
    if (binding?.isWatch && binding.kind.kind === kindName) taken.unshift(...bindings.splice(index, 1));
  }
  return taken;
}

/**
 * Tells whether a custom resource definition is ready to serve its kind.
 * @param definition The definition as the API server returns it.
 * @returns True when its Established condition is True.
 */
export function isEstablished(definition: { status?: { conditions?: { type: string; status: string }[] } }): boolean {
  return (definition.status?.conditions ?? []).some((c) => c.type === "Established" && c.status === "True");
}

/** Copy of what Pepr 2.0.3 does in runBinding, without the handler that throws. Created and changed objects only. */
const startWatch: Starter = async (binding, onGiveUp) => {
  const watcher = K8s(binding.model, { kindOverride: binding.kind }).Watch(
    async (object, phase) => {
      if (phase === WatchPhase.Deleted) return;
      await binding.watchCallback?.(object, phase);
    },
    { resyncFailureMax: 5, resyncDelaySec: 5, lastSeenLimitSeconds: 300, relistIntervalSec: 600 },
  );
  watcher.events.on(WatchEvent.GIVE_UP, (error: Error) => {
    Log.warn({ kind: binding.kind.kind, reason: error.message }, "KMO guarded watch gave up");
    onGiveUp();
  });
  await watcher.start();
  return watcher;
};

/** Watches that KMO starts and stops itself, because their kind may be missing. */
export class GuardedWatch {
  #running: Closable[] = [];
  readonly #kind: string;
  readonly #bindings: WatchBinding[];
  readonly #start: Starter;

  /**
   * @param kind The kind that is watched, for the log.
   * @param bindings The bindings taken from Pepr.
   * @param start How one watch is started; replaced in tests.
   */
  constructor(kind: string, bindings: WatchBinding[], start: Starter = startWatch) {
    this.#kind = kind;
    this.#bindings = bindings;
    this.#start = start;
  }

  /** True while the watches run. */
  get running(): boolean {
    return this.#running.length > 0;
  }

  /** Starts the watches unless they already run. */
  async ensureStarted(): Promise<void> {
    if (this.running || this.#bindings.length === 0) return;
    this.#running = await Promise.all(this.#bindings.map((binding) => this.#start(binding, () => this.stop())));
    Log.info({ kind: this.#kind }, "KMO guarded watch started");
  }

  /** Stops the watches. */
  stop(): void {
    if (!this.running) return;
    for (const watcher of this.#running) watcher.close();
    this.#running = [];
    Log.info({ kind: this.#kind }, "KMO guarded watch stopped");
  }
}

/**
 * Makes the watches on a kind run only while its definition is installed. Call it after those watches are declared.
 * @param capability The capability that declared the watches.
 * @param guarded The kind.
 * @param env The process environment.
 * @returns The guarded watch, or undefined when the guard is off and Pepr keeps the watches.
 */
export function guardKind(
  capability: Capability,
  guarded: GuardedKind,
  env: NodeJS.ProcessEnv = process.env,
): GuardedWatch | undefined {
  if (!guardWanted(guarded, env)) return undefined;
  const watch = new GuardedWatch(guarded.kind, takeWatchBindings(capability, guarded.kind));

  capability
    .When(a.CustomResourceDefinition)
    .IsCreatedOrUpdated()
    .WithName(guarded.definition)
    .Watch(async (definition) => {
      if (isEstablished(definition)) await watch.ensureStarted();
    });

  capability
    .When(a.CustomResourceDefinition)
    .IsDeleted()
    .WithName(guarded.definition)
    .Watch(() => watch.stop());

  return watch;
}
