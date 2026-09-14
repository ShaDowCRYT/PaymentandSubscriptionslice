import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import {
  getOrCreateSubscription,
  deriveEntitlementFromLog,
} from "@/lib/subscription";
import { PLANS, formatAmountMajor } from "@/lib/plans";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Reconcile row state lazily, then serve the plan/period from the log —
    // the subscription row is a synced cache, not the entitlement source.
    const sub = await getOrCreateSubscription(session.userId);
    const entitlement = await deriveEntitlementFromLog(session.userId);
    const planConfig = PLANS[entitlement.plan];

    return NextResponse.json({
      id: sub.id,
      plan: entitlement.plan,
      status: sub.status,
      planLabel: planConfig.label,
      planPrice: formatAmountMajor(planConfig.amountMinor, planConfig.currency),
      currentPeriodEnd: entitlement.currentPeriodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      pendingDowngradeTo: sub.pendingDowngradeTo,
      cancellationReason: sub.cancellationReason,
    });
  } catch (e) {
    console.error("Subscription fetch error:", e);
    return NextResponse.json(
      { error: "Something went wrong." },
      { status: 500 }
    );
  }
}
