import { eq, inArray } from "drizzle-orm";
import { db, schoolMembersTable, schoolsTable } from "@workspace/db";
import { isGlobalAdminRole } from "./school-access";

export type PlanInfo = { plan: "free" | "pilot" | "pro"; until: Date | null; pro: boolean };

/** Paid content is on for "pro", and for "pilot" until its end date. */
export function planIsPro(plan: string, until: Date | null): boolean {
  if (plan === "pro") return !until || until.getTime() > Date.now();
  if (plan === "pilot") return Boolean(until) && until!.getTime() > Date.now();
  return false;
}

export async function schoolPlan(schoolId: string): Promise<PlanInfo> {
  const [row] = await db.select({ plan: schoolsTable.plan, until: schoolsTable.planUntil }).from(schoolsTable).where(eq(schoolsTable.id, schoolId)).limit(1);
  const plan = (row?.plan === "pro" || row?.plan === "pilot" ? row.plan : "free") as PlanInfo["plan"];
  return { plan, until: row?.until ?? null, pro: planIsPro(plan, row?.until ?? null) };
}

/** The best plan among the user's schools. EDUVERSE staff always see everything. */
export async function userPlan(userId: string, role: string): Promise<PlanInfo> {
  if (isGlobalAdminRole(role)) return { plan: "pro", until: null, pro: true };
  const memberships = await db.select({ schoolId: schoolMembersTable.schoolId }).from(schoolMembersTable).where(eq(schoolMembersTable.userId, userId));
  if (memberships.length === 0) return { plan: "free", until: null, pro: false };
  const rows = await db.select({ plan: schoolsTable.plan, until: schoolsTable.planUntil }).from(schoolsTable).where(inArray(schoolsTable.id, memberships.map((row) => row.schoolId)));
  const best = rows.map((row) => ({ plan: row.plan as PlanInfo["plan"], until: row.until, pro: planIsPro(row.plan, row.until) })).sort((a, b) => Number(b.pro) - Number(a.pro))[0];
  return best ?? { plan: "free", until: null, pro: false };
}
