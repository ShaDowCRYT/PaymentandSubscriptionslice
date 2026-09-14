import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import {
  getOrCreateSubscription,
  deriveEntitlementFromLog,
  getProrationPreview,
} from "@/lib/subscription";
import { changePlanSchema } from "@/lib/schemas/subscription";
import { isUpgrade, PLANS } from "@/lib/plans";
import type { PlanType } from "@prisma/client";

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = changePlanSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const newPlan = parsed.data.plan as PlanType;
    // Reconcile row state lazily before deciding (row cache + scheduled changes),
    // then decide on the log-derived entitlement.
    await getOrCreateSubscription(session.userId);
    const entitlement = await deriveEntitlementFromLog(session.userId);

    if (newPlan === entitlement.plan) {
      return NextResponse.json(
        { error: "You are already on this plan" },
        { status: 400 }
      );
    }

    // Downgrade to FREE — cancel at period end (row state, not a payment event)
    if (newPlan === "FREE") {
      await prisma.subscription.update({
        where: { userId: session.userId },
        data: {
          cancelAtPeriodEnd: true,
          pendingDowngradeTo: "FREE",
        },
      });
      return NextResponse.json({
        success: true,
        action: "downgrade_scheduled",
        message: "Your plan will change to Free at the end of the current period.",
      });
    }

    // Upgrade: return proration preview — actual payment goes through /api/checkout
    if (isUpgrade(entitlement.plan, newPlan)) {
      const proration = await getProrationPreview(session.userId, newPlan);
      return NextResponse.json({
        action: "upgrade_requires_payment",
        proration,
        plan: newPlan,
        planLabel: PLANS[newPlan].label,
      });
    }

    // Downgrade from YEARLY to MONTHLY — schedule for period end
    await prisma.subscription.update({
      where: { userId: session.userId },
      data: {
        pendingDowngradeTo: newPlan,
      },
    });

    return NextResponse.json({
      success: true,
      action: "downgrade_scheduled",
      message: `Your plan will change to ${PLANS[newPlan].label} at the end of the current period.`,
    });
  } catch (e) {
    console.error("Change plan error:", e);
    return NextResponse.json(
      { error: "Something went wrong." },
      { status: 500 }
    );
  }
}
