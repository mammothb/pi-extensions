/**
 * In-memory session approval cache.
 *
 * Remembers user decisions for the current session so identical
 * permission requests don't re-prompt. Resets on pi restart.
 */
export class ApprovalCache {
  #approvals = new Map<string, "allow" | "deny">();

  /** Check if a decision exists for the given key. */
  has(key: string): boolean {
    return this.#approvals.has(key);
  }

  /** Get a stored decision, or undefined if not found. */
  get(key: string): "allow" | "deny" | undefined {
    return this.#approvals.get(key);
  }

  /** Store a decision for the given key. */
  set(key: string, decision: "allow" | "deny"): void {
    this.#approvals.set(key, decision);
  }

  /** Clear all stored decisions. */
  clear(): void {
    this.#approvals.clear();
  }
}
