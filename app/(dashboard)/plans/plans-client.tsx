"use client";

import { useState } from "react";
import { PLANS, formatAmountMajor } from "@/lib/plans";
import type { PlanType } from "@prisma/client";

interface PlansClientProps {
  currentPlan: PlanType;
  cancelAtPeriodEnd: boolean;
  pendingDowngradeTo: PlanType | null;
}

export default function PlansClient({
  currentPlan,
  cancelAtPeriodEnd,
  pendingDowngradeTo,
}: PlansClientProps) {
  const [loading, setLoading] = useState<PlanType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSelectPlan(plan: PlanType) {
    if (plan === currentPlan) return;

    setLoading(plan);
    setError(null);
    setMessage(null);

    try {
      // For upgrades to paid plans, use the change-plan endpoint first
      // to get proration info, then redirect to checkout
      const res = await fetch("/api/subscription/change-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Something went wrong");
        return;
      }

      if (data.action === "upgrade_requires_payment") {
        // Redirect to checkout
        const checkoutRes = await fetch("/api/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan }),
        });

        const checkoutData = await checkoutRes.json();

        if (!checkoutRes.ok) {
          setError(checkoutData.error || "Checkout failed");
          return;
        }

        // Redirect to Flutterwave payment page
        window.location.href = checkoutData.paymentLink;
        return;
      }

      if (data.action === "downgrade_scheduled") {
        setMessage(data.message);
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(null);
    }
  }

  const plans: { type: PlanType; popular?: boolean }[] = [
    { type: "FREE" },
    { type: "MONTHLY", popular: true },
    { type: "YEARLY" },
  ];

  return (
    <div>
      {error && (
        <div className="mb-6 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      )}
      {message && (
        <div className="mb-6 rounded-md bg-green-50 p-3 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-400">
          {message}
        </div>
      )}

      <div className="grid gap-6 sm:grid-cols-3">
        {plans.map(({ type, popular }) => {
          const config = PLANS[type];
          const isCurrent = type === currentPlan;
          const isPending = type === pendingDowngradeTo;

          return (
            <div
              key={type}
              className={`relative rounded-lg border p-6 ${
                isCurrent
                  ? "border-zinc-900 dark:border-zinc-100"
                  : "border-zinc-200 dark:border-zinc-800"
              } bg-white dark:bg-zinc-900`}
            >
              {popular && (
                <span className="absolute -top-2.5 left-4 rounded-full bg-zinc-900 px-2.5 py-0.5 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
                  Popular
                </span>
              )}

              <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                {config.label}
              </h3>

              <p className="mt-2 text-3xl font-bold text-zinc-900 dark:text-zinc-100">
                {type === "FREE"
                  ? "Free"
                  : formatAmountMajor(config.amountMinor, config.currency)}
              </p>
              {type !== "FREE" && (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  per {type === "MONTHLY" ? "month" : "year"}
                </p>
              )}

              <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
                {config.description}
              </p>

              <button
                onClick={() => handleSelectPlan(type)}
                disabled={isCurrent || loading !== null}
                className={`mt-6 w-full rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                  isCurrent
                    ? "cursor-default bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500"
                    : loading === type
                      ? "cursor-wait bg-zinc-300 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-400"
                      : "bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                }`}
              >
                {isCurrent
                  ? "Current Plan"
                  : isPending
                    ? "Pending"
                    : loading === type
                      ? "Processing…"
                      : type === "FREE"
                        ? "Downgrade"
                        : currentPlan === "FREE"
                          ? "Subscribe"
                          : "Switch"}
              </button>
            </div>
          );
        })}
      </div>

      {cancelAtPeriodEnd && (
        <p className="mt-6 text-sm text-amber-600 dark:text-amber-400">
          Your subscription is scheduled for cancellation. You retain access
          until the end of your current billing period.
        </p>
      )}
    </div>
  );
}
