import type { ClientSession } from "mongodb";

export type MutationContext = { session: ClientSession; operationId: string };

// Legacy records have revision 0 until their first successful, atomic update.
export function revisionFilter(expected: number) {
  return expected === 0 ? { $or: [{ revision: 0 }, { revision: { $exists: false } }] } : { revision: expected };
}
