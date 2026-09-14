// Pure proration math — no side effects, no database access.
// All amounts in minor units (kobo). Currency stored alongside.

import type { PlanType } from "@prisma/client";
import { PLANS } from "@/lib/plans";

export interface ProrationResult {
  /** Days remaining in the current billing period */
  daysRemaining: number;
  /** Total days in the current billing period */
  totalDays: number;
  /** Credit for unused time on the current plan (minor units) */
  creditMinor: number;
  /** Full charge for the new plan (minor units) */
  newPlanChargeMinor: number;
  /** Net amount to charge: newPlanCharge − credit (minor units, floored at 0) */
  netChargeMinor: number;
  /** Currency code */
  currency: string;
}

/**
 * Calculate the prorated charge when upgrading mid-cycle.
 *
 * Formula:
 *   daysRemaining  = floor((currentPeriodEnd − now) / msPerDay)
 *   dailyRate      = currentPlanAmount / totalDays
 *   credit         = floor(dailyRate × daysRemaining)
 *   netCharge      = max(0, newPlanAmount − credit)
 *
 * All rounding is integer-safe: floor() on days remaining and on the credit
 * means the platform never over-credits; the user is charged at most the full
 * new-plan price.
 */
export function calculateProration(
  currentPlan: PlanType,
  newPlan: PlanType,
  currentPeriodEnd: Date
): ProrationResult {
  const currentConfig = PLANS[currentPlan];
  const newConfig = PLANS[newPlan];
  const currency = currentConfig.currency;

  const now = new Date();
  const msPerDay = 24 * 60 * 60 * 1000;
  const totalDays = currentConfig.intervalDays;

  // Days remaining: how much of the current period is unused
  const daysRemaining = Math.max(
    0,
    Math.floor((currentPeriodEnd.getTime() - now.getTime()) / msPerDay)
  );

  // Credit for unused days on the current plan
  let creditMinor = 0;
  if (totalDays > 0 && daysRemaining > 0) {
    const dailyRate = currentConfig.amountMinor / totalDays;
    creditMinor = Math.floor(dailyRate * daysRemaining);
  }

  const newPlanChargeMinor = newConfig.amountMinor;
  const netChargeMinor = Math.max(0, newPlanChargeMinor - creditMinor);

  return {
    daysRemaining,
    totalDays,
    creditMinor,
    newPlanChargeMinor,
    netChargeMinor,
    currency,
  };
}
