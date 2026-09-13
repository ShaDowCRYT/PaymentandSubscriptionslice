// Plan configuration — single source of truth for pricing.
// All amounts in minor units (kobo for NGN). Currency stored alongside.

import type { PlanType } from "@prisma/client";

export interface PlanConfig {
  amountMinor: number;
  currency: string;
  intervalDays: number;
  label: string;
  description: string;
}

export const PLANS: Record<PlanType, PlanConfig> = {
  FREE: {
    amountMinor: 0,
    currency: "NGN",
    intervalDays: 0,
    label: "Free",
    description: "Basic access with no charge",
  },
  MONTHLY: {
    amountMinor: 500_000, // ₦5,000
    currency: "NGN",
    intervalDays: 30,
    label: "Monthly",
    description: "₦5,000 billed every month",
  },
  YEARLY: {
    amountMinor: 4_800_000, // ₦48,000 (~20% discount vs monthly)
    currency: "NGN",
    intervalDays: 365,
    label: "Yearly",
    description: "₦48,000 billed once a year",
  },
} as const;

/** Convert minor units (kobo) to major units (naira) for display. */
export function formatAmountMajor(amountMinor: number, currency: string): string {
  const major = amountMinor / 100;
  if (currency === "NGN") {
    return `₦${major.toLocaleString("en-NG", { minimumFractionDigits: 0 })}`;
  }
  return `${currency} ${major.toFixed(2)}`;
}

/** Whether a plan change from → to is an upgrade. */
export function isUpgrade(from: PlanType, to: PlanType): boolean {
  const rank: Record<PlanType, number> = { FREE: 0, MONTHLY: 1, YEARLY: 2 };
  return rank[to] > rank[from];
}
