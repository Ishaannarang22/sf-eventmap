import { createHash } from 'node:crypto';

/** Stable short id from any string(s). Used for canonical event ids + content hashes. */
export function hashId(...parts: (string | undefined)[]): string {
  return createHash('sha1').update(parts.filter(Boolean).join('|')).digest('hex').slice(0, 16);
}

/** Hash of a raw payload, to detect unchanged rows between runs. */
export function contentHash(payload: unknown): string {
  return createHash('sha1').update(JSON.stringify(payload)).digest('hex').slice(0, 16);
}
