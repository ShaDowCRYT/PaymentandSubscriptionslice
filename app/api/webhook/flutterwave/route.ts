import { NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/flutterwave";
import { verifyAndFulfill } from "@/lib/subscription";
import type { PlanType } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Flutterwave webhook handler.
 *
 * Security: verifies the `verif-hash` header against FLUTTERWAVE_WEBHOOK_SECRET
 * before processing. Idempotent — a repeated webhook is recorded once and
 * acted on once, thanks to the @@unique([providerReference, eventType]) constraint.
 */
export async function POST(request: Request) {
  try {
    // Step 1: Verify webhook signature (PRD requirement #4)
    const verifHash = request.headers.get("verif-hash");
    if (!verifyWebhookSignature(verifHash)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const payload = await request.json();

    // Flutterwave sends the event type and data
    const event = payload.event;
    const data = payload.data;

    // We only process successful charge events
    if (event !== "charge.completed" || data?.status !== "successful") {
      // Acknowledge receipt but don't process
      return NextResponse.json({ received: true });
    }

    const transactionId = String(data.id);
    const txRef = data.tx_ref as string;

    if (!transactionId || !txRef) {
      return NextResponse.json({ error: "Missing transaction data" }, { status: 400 });
    }

    // Look up the plan from the initiated event
    const initiatedEvent = await prisma.paymentEvent.findFirst({
      where: { txRef, eventType: "INITIATED" },
    });

    if (!initiatedEvent) {
      console.error(`Webhook: no INITIATED event for tx_ref ${txRef}`);
      return NextResponse.json({ error: "Unknown transaction" }, { status: 400 });
    }

    // Determine the plan from the redirect URL or metadata
    // Since we store the plan in the redirect URL during checkout, we need to
    // determine it from the subscription's context
    const sub = await prisma.subscription.findUnique({
      where: { userId: initiatedEvent.userId },
    });

    // Default to figuring out the plan from the amount
    let plan: PlanType = "MONTHLY";
    if (sub?.pendingDowngradeTo) {
      plan = sub.pendingDowngradeTo;
    } else {
      // Infer from the initiated event amount
      // ₦48,000 (4_800_000 kobo) = YEARLY, else MONTHLY
      if (initiatedEvent.amountMinor >= 4_800_000) {
        plan = "YEARLY";
      }
    }

    const result = await verifyAndFulfill(transactionId, txRef, plan);

    if (result.alreadyProcessed) {
      // Idempotent: already processed, not an error
      return NextResponse.json({ received: true, duplicate: true });
    }

    if (!result.success) {
      console.error(`Webhook verification failed for ${txRef}: ${result.error}`);
      return NextResponse.json({ received: true, error: result.error });
    }

    return NextResponse.json({ received: true, fulfilled: true });
  } catch (e) {
    console.error("Webhook error:", e);
    // Always return 200 to Flutterwave so it doesn't retry indefinitely
    // The error is logged server-side for investigation
    return NextResponse.json({ received: true, error: "Internal error" });
  }
}
