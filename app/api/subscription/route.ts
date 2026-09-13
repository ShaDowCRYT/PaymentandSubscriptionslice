import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getOrCreateSubscription } from "@/lib/subscription";
import { PLANS, formatAmountMajor } from "@/lib/plans";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sub = await getOrCreateSubscription(session.userId);
    const planConfig = PLANS[sub.plan];

    return NextResponse.json({
      id: sub.id,
      plan: sub.plan,
      status: sub.status,
      planLabel: planConfig.label,
      planPrice: formatAmountMajor(planConfig.amountMinor, planConfig.currency),
      currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
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
