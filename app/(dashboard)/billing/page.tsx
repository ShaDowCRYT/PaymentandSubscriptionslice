import { getSession } from "@/lib/session";
import {
  getOrCreateSubscription,
  deriveEntitlementFromLog,
} from "@/lib/subscription";
import { PLANS, formatAmountMajor } from "@/lib/plans";
import { redirect } from "next/navigation";
import { CancelButton, ReactivateButton } from "./billing-actions";

export default async function BillingPage() {
  const session = await getSession();
  if (!session) redirect("/signin");

  // Entitlement (the plan you're actually on, and until when) comes from the
  // payment log. Cancellation / downgrade intent stays the row's mutable state.
  const sub = await getOrCreateSubscription(session.userId);
  const entitlement = await deriveEntitlementFromLog(session.userId);
  const planConfig = PLANS[entitlement.plan];

  return (
    <div>
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
        Billing
      </h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Manage your subscription and billing details.
      </p>

      {/* Subscription details card */}
      <div className="mt-8 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Subscription
        </h2>

        <dl className="mt-4 space-y-4">
          {/* Plan */}
          <div className="flex justify-between">
            <dt className="text-sm text-zinc-500 dark:text-zinc-400">Plan</dt>
            <dd className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {planConfig.label}
            </dd>
          </div>

          {/* Price */}
          {entitlement.plan !== "FREE" && (
            <div className="flex justify-between">
              <dt className="text-sm text-zinc-500 dark:text-zinc-400">
                Price
              </dt>
              <dd className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {formatAmountMajor(planConfig.amountMinor, planConfig.currency)}{" "}
                / {entitlement.plan === "MONTHLY" ? "month" : "year"}
              </dd>
            </div>
          )}

          {/* Status */}
          <div className="flex justify-between">
            <dt className="text-sm text-zinc-500 dark:text-zinc-400">
              Status
            </dt>
            <dd>
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  sub.status === "ACTIVE"
                    ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                    : sub.status === "CANCELED"
                      ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                      : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
                }`}
              >
                {sub.status}
              </span>
            </dd>
          </div>

          {/* Renewal / Period End */}
          {entitlement.currentPeriodEnd && (
            <div className="flex justify-between">
              <dt className="text-sm text-zinc-500 dark:text-zinc-400">
                {sub.cancelAtPeriodEnd ? "Access Until" : "Renewal Date"}
              </dt>
              <dd className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {entitlement.currentPeriodEnd.toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </dd>
            </div>
          )}

          {/* Pending downgrade */}
          {sub.pendingDowngradeTo && (
            <div className="flex justify-between">
              <dt className="text-sm text-zinc-500 dark:text-zinc-400">
                Pending Change
              </dt>
              <dd className="text-sm font-medium text-amber-600 dark:text-amber-400">
                Downgrade to {PLANS[sub.pendingDowngradeTo].label} at period end
              </dd>
            </div>
          )}

          {/* Cancellation info */}
          {sub.cancelAtPeriodEnd && (
            <div className="rounded-md bg-amber-50 p-3 dark:bg-amber-900/10">
              <p className="text-sm text-amber-700 dark:text-amber-400">
                Your subscription is scheduled for cancellation. You retain full
                access until the end of your current billing period.
              </p>
              {sub.cancellationReason && (
                <p className="mt-1 text-sm text-amber-600 dark:text-amber-500">
                  Reason: {sub.cancellationReason}
                </p>
              )}
            </div>
          )}
        </dl>

        {/* Action buttons */}
        <div className="mt-6 flex flex-wrap gap-3">
          <a
            href="/plans"
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Change Plan
          </a>

          <CancelButton
            plan={entitlement.plan}
            cancelAtPeriodEnd={sub.cancelAtPeriodEnd}
          />

          <ReactivateButton cancelAtPeriodEnd={sub.cancelAtPeriodEnd} />
        </div>
      </div>
    </div>
  );
}
