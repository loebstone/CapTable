import { db, snapshots } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { yearDetail } from "../distribution-years";
import { HttpError } from "../errors";

export type ReportContext = Awaited<ReturnType<typeof reportContext>>;
export type ReportYear = Awaited<ReturnType<typeof yearDetail>>;
export type ReportHolder = ReportYear["holders"][number];
export async function reportContext(id: number) {
  return db.transaction(async (tx) => {
    const year = await yearDetail(tx, id);
    const [snapshot] = await tx.select().from(snapshots).where(eq(snapshots.id, year.snapshotId)).limit(1);
    const [identity] = (await tx.execute(sql`SELECT current_database() AS "databaseName", inet_server_addr()::text AS "serverAddress"`)).rows;
    return {
      year, classes: snapshot.classes, snapshotAsOf: snapshot.asOf,
      environment: process.env.NODE_ENV === "production" ? "production" : "development",
      databaseName: String(identity.databaseName), serverAddress: identity.serverAddress == null ? null : String(identity.serverAddress),
      generatedAt: new Date().toISOString(),
    };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
export function finalized(context: ReportContext, kind: "statements" | "ledger" = "statements") {
  if (context.year.status === "draft" && !context.year.isPractice) throw new HttpError(409,
    kind === "statements" ? "Shareholder statements require a finalized year" : "Ledger exports require a finalized year");
}
export function reportHolder(context: ReportContext, personId: string) {
  const holder = context.year.holders.find((h) => h.personId === personId);
  if (!holder) throw new HttpError(404, "Shareholder is not in this year's fixed snapshot");
  return holder;
}
export function reportDate(context: ReportContext) {
  return context.generatedAt.slice(0, 10); // One UTC generation date shared by the entire ZIP.
}
function safeName(value: string) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^A-Za-z0-9-]/g, "") || "Name";
}
export function statementFilename(context: ReportContext, holder: ReportHolder) {
  // Roster supplies only displayName, not structured names. This explicit
  // surname-first inference matches the Farm fixture. The first given token is
  // used in the filename; the full unmodified name is printed in the statement.
  const [last, ...given] = holder.displayName.trim().split(/\s+/);
  return `HWD_Distribution_${context.year.calendarYear}_${context.year.isPractice ? "Practice_" : ""}Statement_${safeName(last)}_${safeName(given[0] || last)}_${reportDate(context)}.pdf`;
}
export function noticeFilename(context: ReportContext, holder: ReportHolder) {
  return statementFilename(context, holder).replace("_Statement_", "_Notice_");
}
export function reportFilename(context: ReportContext, kind: "board" | "ledger" | "zip" | "notices") {
  const suffix = { board: "Board_Summary", ledger: "Ledger", zip: "Statements", notices: "Notices" }[kind];
  const extension = { board: "pdf", ledger: "xlsx", zip: "zip", notices: "zip" }[kind];
  return `HWD_Distribution_${context.year.calendarYear}_${context.year.isPractice ? "Practice_" : ""}${suffix}_${reportDate(context)}.${extension}`;
}
