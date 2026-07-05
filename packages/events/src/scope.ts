import { createHash } from "node:crypto";

/**
 * Deterministic 12-hex-character id derived from a file path, used as the
 * `data-flow-scope` value so handler names declared in different files never
 * collide in the delegated document-level listener.
 */
export function hashScope(filePath: string): string {
  return createHash("sha256").update(filePath).digest("hex").slice(0, 12);
}
