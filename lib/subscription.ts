// Subscription service — the core business logic for plan management.
// Every mutation logs to the PaymentEvent table (append-only by convention).
// Entitlement is only granted after server-side verification with Flutterwave.

import { prisma } from "@/lib/prisma";
import { PLANS, isUpgrade } from "@/lib/plans";
import { calculateProration } from "@/lib/proration";
import { initializePayment, verifyTransaction } from "@/lib/flutterwave";
import type { PlanType, Subscription, Prisma } from "@prisma/client";
import { randomBytes } from "crypto";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateTxRef(): string {
  return `ps_${Date.now()}_${randomBytes(8).toString("hex")}`;
}

function periodEndFromNow(plan: PlanType): Date {
  const days = PLANS[plan].intervalDays;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Get or create subscription
// ---------------------------------------------------------------------------

export async function getOrCreateSubscription(userId: string): Promise<Subscription> {
  const existing = await prisma.subscription.findUnique({ where: { userId } });
  if (existing) return existing;

  return prisma.subscription.create({
    data: { userId, plan: "FREE", status: "ACTIVE" },
  });
}

// ---------------------------------------------------------------------------
// Checkout initiation
// ---------------------------------------------------------------------------

export interface CheckoutResult {
  paymentLink: string;
  txRef: string;
}

export async function initiateCheckout(
  userId: string,
  plan: "MONTHLY" | "YEARLY",
  customerEmail: string,
  customerName: string
): Promise<CheckoutResult> {
  const sub = await getOrCreateSubscription(userId);
  const planConfig = PLANS[plan];
  const txRef = generateTxRef();

  let amountMinor = planConfig.amountMinor;

  // If upgrading mid-cycle, prorate
  if (sub.plan !== "FREE" && sub.currentPeriodEnd && isUpgrade(sub.plan, plan)) {
    const proration = calculateProration(sub.plan, plan, sub.currentPeriodEnd);
    amountMinor = proration.netChargeMinor;
  }

  // Log the INITIATED event
  await prisma.paymentEvent.create({
    data: {
      userId,
      subscriptionId: sub.id,
      eventType: "INITIATED",
      txRef,
      amountMinor,
      currency: planConfig.currency,
    },
  });

  const appUrl = process.env.APP_URL ?? "http://localhost:3000";

  // Initialize with Flutterwave — get payment link
  const { link } = await initializePayment({
    txRef,
    amountMinor,
    currency: planConfig.currency,
    customerEmail,
    customerName,
    redirectUrl: `${appUrl}/checkout/return?tx_ref=${txRef}&plan=${plan}`,
    title: `Subscribe — ${planConfig.label}`,
  });

  return { paymentLink: link, txRef };
}

// ---------------------------------------------------------------------------
// Verify and fulfill (called from webhook or return page)
// ---------------------------------------------------------------------------

export interface VerifyResult {
  success: boolean;
  alreadyProcessed?: boolean;
  error?: string;
}

export async function verifyAndFulfill(
  transactionId: string,
  expectedTxRef: string,
  plan: PlanType
): Promise<VerifyResult> {
  // Server-side verification with Flutterwave — the authoritative check
  const verification = await verifyTransaction(transactionId);

  if (verification.txRef !== expectedTxRef) {
    return { success: false, error: "Transaction reference mismatch" };
  }

  // Find the INITIATED event to get userId and subscriptionId
  const initiatedEvent = await prisma.paymentEvent.findFirst({
    where: { txRef: expectedTxRef, eventType: "INITIATED" },
  });

  if (!initiatedEvent) {
    return { success: false, error: "No initiated event found for this transaction" };
  }

  const userId = initiatedEvent.userId;
  const subscriptionId = initiatedEvent.subscriptionId;

  // Check payment status
  if (verification.status !== "successful") {
    // Log the FAILED event — idempotent via unique constraint
    try {
      await prisma.paymentEvent.create({
        data: {
          userId,
          subscriptionId,
          eventType: "FAILED",
          txRef: expectedTxRef,
          providerReference: verification.flwRef,
          amountMinor: Math.round(verification.amountMajor * 100),
          currency: verification.currency,
          rawPayload: verification.rawPayload as Prisma.InputJsonValue,
        },
      });
    } catch (e: unknown) {
      if (isUniqueConstraintError(e)) {
        return { success: false, alreadyProcessed: true, error: "Payment failed (already recorded)" };
      }
      throw e;
    }
    return { success: false, error: `Payment status: ${verification.status}` };
  }

  // Log VERIFIED event — idempotent
  try {
    await prisma.paymentEvent.create({
      data: {
        userId,
        subscriptionId,
        eventType: "VERIFIED",
        txRef: expectedTxRef,
        providerReference: verification.flwRef,
        amountMinor: Math.round(verification.amountMajor * 100),
        currency: verification.currency,
        rawPayload: verification.rawPayload as Prisma.InputJsonValue,
      },
    });
  } catch (e: unknown) {
    if (isUniqueConstraintError(e)) {
      return { success: true, alreadyProcessed: true };
    }
    throw e;
  }

  // Fulfill: update the subscription
  const newPeriodEnd = periodEndFromNow(plan);

  await prisma.subscription.update({
    where: { userId },
    data: {
      plan,
      status: "ACTIVE",
      currentPeriodEnd: newPeriodEnd,
      cancelAtPeriodEnd: false,
      pendingDowngradeTo: null,
      cancellationReason: null,
    },
  });

  // Log FULFILLED event — idempotent
  try {
    await prisma.paymentEvent.create({
      data: {
        userId,
        subscriptionId,
        eventType: "FULFILLED",
        txRef: expectedTxRef,
        providerReference: verification.flwRef,
        amountMinor: Math.round(verification.amountMajor * 100),
        currency: verification.currency,
      },
    });
  } catch (e: unknown) {
    if (isUniqueConstraintError(e)) {
      // Already fulfilled — that's fine
    } else {
      throw e;
    }
  }

  return { success: true };
}

// ---------------------------------------------------------------------------
// Cancel subscription
// ---------------------------------------------------------------------------

export async function cancelSubscription(
  userId: string,
  reason?: string
): Promise<{ success: boolean; error?: string }> {
  const sub = await prisma.subscription.findUnique({ where: { userId } });

  if (!sub || sub.plan === "FREE") {
    return { success: false, error: "No active paid subscription to cancel" };
  }

  if (sub.cancelAtPeriodEnd) {
    return { success: false, error: "Subscription is already scheduled for cancellation" };
  }

  await prisma.subscription.update({
    where: { userId },
    data: {
      cancelAtPeriodEnd: true,
      cancellationReason: reason ?? null,
    },
  });

  return { success: true };
}

// ---------------------------------------------------------------------------
// Reactivate (undo a pending cancellation)
// ---------------------------------------------------------------------------

export async function reactivateSubscription(
  userId: string
): Promise<{ success: boolean; error?: string }> {
  const sub = await prisma.subscription.findUnique({ where: { userId } });

  if (!sub || !sub.cancelAtPeriodEnd) {
    return { success: false, error: "No pending cancellation to reactivate" };
  }

  // Can only reactivate before the period actually ends
  if (sub.currentPeriodEnd && sub.currentPeriodEnd < new Date()) {
    return { success: false, error: "Subscription period has already ended" };
  }

  await prisma.subscription.update({
    where: { userId },
    data: {
      cancelAtPeriodEnd: false,
      cancellationReason: null,
    },
  });

  return { success: true };
}

// ---------------------------------------------------------------------------
// Get proration preview (for UI display before payment)
// ---------------------------------------------------------------------------

export async function getProrationPreview(userId: string, newPlan: PlanType) {
  const sub = await getOrCreateSubscription(userId);

  if (sub.plan === "FREE" || !sub.currentPeriodEnd) {
    return null; // No proration for free → paid, just full price
  }

  return calculateProration(sub.plan, newPlan, sub.currentPeriodEnd);
}

// ---------------------------------------------------------------------------
// Prisma unique constraint detection
// ---------------------------------------------------------------------------

function isUniqueConstraintError(e: unknown): boolean {
  return (
    e !== null &&
    typeof e === "object" &&
    "code" in e &&
    (e as { code: string }).code === "P2002"
  );
}
