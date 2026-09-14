import { getSession } from "@/lib/session";
import {
  getOrCreateSubscription,
  deriveEntitlementFromLog,
} from "@/lib/subscription";
import { PLANS, formatAmountMajor } from "@/lib/plans";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/signin");

  const sub = await getOrCreateSubscription(session.userId);
  const entitlement = await deriveEntitlementFromLog(session.userId);
  const planConfig = PLANS[entitlement.plan];

  return (
    <div>
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
        Dashboard
      </h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Manage your subscription and billing.
      </p>

      {/* Current plan card */}
      <div className="mt-8 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
              Current Plan
            </p>
            <p className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-100">
              {planConfig.label}
            </p>
            {entitlement.plan !== "FREE" && (
              <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
                {formatAmountMajor(planConfig.amountMinor, planConfig.currency)}{" "}
                / {entitlement.plan === "MONTHLY" ? "month" : "year"}
              </p>
            )}
          </div>

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
        </div>

        {sub.cancelAtPeriodEnd && entitlement.currentPeriodEnd && (
          <p className="mt-3 text-sm text-amber-600 dark:text-amber-400">
            Cancels at end of period:{" "}
            {entitlement.currentPeriodEnd.toLocaleDateString("en-GB", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </p>
        )}

        {sub.pendingDowngradeTo && (
          <p className="mt-3 text-sm text-amber-600 dark:text-amber-400">
            Downgrade to {PLANS[sub.pendingDowngradeTo].label} scheduled at period end.
          </p>
        )}

        <div className="mt-6 flex gap-3">
          <a
            href="/plans"
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {entitlement.plan === "FREE" ? "Upgrade" : "Change Plan"}
          </a>
          <a
            href="/billing"
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Billing
          </a>
        </div>
      </div>
    </div>
  );
}
