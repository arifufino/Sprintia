import type { Db } from "mongodb";
import type { ReportEvent } from "../app/lib/reports";
import type { MutationContext } from "./mutation-context";
type Input = ReportEvent extends infer E ? E extends ReportEvent ? Omit<E, "version" | "sequence" | "at"> & { at?: string } : never : never;
// Same transaction and activity as the domain change. A project-local sequence
// orders equal timestamps and never advances on a failed save or receipt replay.
export async function reportEvent(db: Db, workspaceId: string, context: MutationContext, input: Input): Promise<ReportEvent> {
  const row = await db.collection<{ _id: string; reportSequence?: number }>("workspaces").findOneAndUpdate({ _id: workspaceId }, { $inc: { reportSequence: 1 } }, { returnDocument: "after", session: context.session });
  if (!row) throw new Error("Missing report project");
  return { ...input, version: 1, sequence: row.reportSequence!, at: input.at ?? new Date().toISOString() } as ReportEvent;
}
