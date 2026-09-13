import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { verifyAndFulfill } from "@/lib/subscription";
import type { PlanType } from "@prisma/client";

/**
 * Server-side verification endpoint called from the checkout return page.
 * This is the actual security gate — the return URL redirect alone grants nothing.
 */
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { transaction_id, tx_ref, plan } = body;

    if (!transaction_id || !tx_ref) {
      return NextResponse.json(
        { error: "Missing transaction_id or tx_ref" },
        { status: 400 }
      );
    }

    const validPlans: PlanType[] = ["MONTHLY", "YEARLY"];
    const resolvedPlan: PlanType = validPlans.includes(plan) ? plan : "MONTHLY";

    const result = await verifyAndFulfill(
      String(transaction_id),
      String(tx_ref),
      resolvedPlan
    );

    if (!result.success && !result.alreadyProcessed) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true, alreadyProcessed: result.alreadyProcessed });
  } catch (e) {
    console.error("Checkout verify error:", e);
    return NextResponse.json(
      { error: "Verification failed. Please contact support." },
      { status: 500 }
    );
  }
}
