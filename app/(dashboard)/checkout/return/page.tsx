"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

type Status = "loading" | "verifying" | "success" | "error";

export default function CheckoutReturnPage() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Landing on this page alone does NOT grant entitlement (PRD trap #2).
    // The page triggers server-side verification — visiting the URL directly
    // without a valid transaction_id shows an error, never a subscription.

    async function verify() {
      const txRef = searchParams.get("tx_ref");
      const transactionId = searchParams.get("transaction_id");
      const flwStatus = searchParams.get("status");
      const plan = searchParams.get("plan");

      if (!txRef || !transactionId) {
        setStatus("error");
        setError(
          "Missing payment information. Please try again from the Plans page."
        );
        return;
      }

      if (flwStatus === "cancelled") {
        setStatus("error");
        setError("Payment was cancelled. No charge was made.");
        return;
      }

      setStatus("verifying");
      try {
        // We use the same webhook verification logic server-side.
        // This calls verifyAndFulfill which does the real Flutterwave server-side check.
        const res = await fetch("/api/checkout/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transaction_id: transactionId,
            tx_ref: txRef,
            plan,
          }),
        });

        const data = await res.json();

        if (!res.ok || !data.success) {
          setStatus("error");
          setError(data.error || "Verification failed. Please contact support.");
          return;
        }

        setStatus("success");
      } catch {
        setStatus("error");
        setError("Something went wrong during verification. Please contact support.");
      }
    }

    verify();
  }, [searchParams]);

  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
        {status === "loading" && (
          <>
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-zinc-200 border-t-zinc-900 dark:border-zinc-700 dark:border-t-zinc-100" />
            <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
              Loading payment details…
            </p>
          </>
        )}

        {status === "verifying" && (
          <>
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-zinc-200 border-t-zinc-900 dark:border-zinc-700 dark:border-t-zinc-100" />
            <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-300">
              Verifying your payment with Flutterwave…
            </p>
            <p className="mt-1 text-xs text-zinc-400">
              This may take a few seconds.
            </p>
          </>
        )}

        {status === "success" && (
          <>
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
              <svg
                className="h-6 w-6 text-green-600 dark:text-green-400"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4.5 12.75l6 6 9-13.5"
                />
              </svg>
            </div>
            <h2 className="mt-4 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Payment Successful
            </h2>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              Your subscription has been activated. You can view your plan
              details in Billing.
            </p>
            <div className="mt-6 flex justify-center gap-3">
              <a
                href="/billing"
                className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                View Billing
              </a>
              <a
                href="/dashboard"
                className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Dashboard
              </a>
            </div>
          </>
        )}

        {status === "error" && (
          <>
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
              <svg
                className="h-6 w-6 text-red-600 dark:text-red-400"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </div>
            <h2 className="mt-4 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Payment Issue
            </h2>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              {error}
            </p>
            <div className="mt-6">
              <a
                href="/plans"
                className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                Back to Plans
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
