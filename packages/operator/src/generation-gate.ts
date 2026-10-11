/** The parts of an object the gate reads. */
interface Versioned {
  metadata?: { uid?: string; generation?: number };
}

/** Remembers the spec generation last seen of each object, to tell spec changes from other updates. */
export class GenerationGate {
  readonly #seen = new Map<string, number>();

  /**
   * Records an object and tells whether its spec changed since it was last seen.
   * @param object The object a watch delivered.
   * @returns True the first time, and whenever the generation differs from the one recorded.
   */
  changed(object: Versioned): boolean {
    const uid = object.metadata?.uid ?? "";
    const generation = object.metadata?.generation ?? 0;
    if (this.#seen.get(uid) === generation) return false;
    this.#seen.set(uid, generation);
    return true;
  }

  /**
   * Drops what is remembered of an object.
   * @param object The object that was deleted.
   */
  forget(object: Versioned): void {
    this.#seen.delete(object.metadata?.uid ?? "");
  }
}
