"use client";

import { useState } from "react";

interface BillingActionsProps {
  plan: string;
  cancelAtPeriodEnd: boolean;
}

export function CancelButton({ plan, cancelAtPeriodEnd }: BillingActionsProps) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (plan === "FREE" || cancelAtPeriodEnd || success) return null;

  async function handleCancel() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/subscription/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong");
        return;
      }
      setSuccess(true);
      // Reload to show updated state
      window.location.reload();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (!showConfirm) {
    return (
      <button
        onClick={() => setShowConfirm(true)}
        className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
      >
        Cancel Subscription
      </button>
    );
  }

  return (
    <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-900/10">
      <p className="text-sm font-medium text-red-800 dark:text-red-300">
        Are you sure you want to cancel?
      </p>
      <p className="mt-1 text-sm text-red-600 dark:text-red-400">
        You&apos;ll keep access until the end of your current billing period.
      </p>

      <div className="mt-3">
        <label
          htmlFor="cancel-reason"
          className="block text-sm text-red-700 dark:text-red-400"
        >
          Reason for cancelling (optional)
        </label>
        <textarea
          id="cancel-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          maxLength={500}
          className="mt-1 w-full rounded-md border border-red-200 bg-white p-2 text-sm text-zinc-900 dark:border-red-800 dark:bg-zinc-900 dark:text-zinc-100"
          placeholder="Help us improve…"
        />
      </div>

      {error && (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      <div className="mt-3 flex gap-2">
        <button
          onClick={handleCancel}
          disabled={loading}
          className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-wait disabled:opacity-50"
        >
          {loading ? "Cancelling…" : "Confirm Cancel"}
        </button>
        <button
          onClick={() => setShowConfirm(false)}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Keep Subscription
        </button>
      </div>
    </div>
  );
}

export function ReactivateButton({
  cancelAtPeriodEnd,
}: {
  cancelAtPeriodEnd: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!cancelAtPeriodEnd) return null;

  async function handleReactivate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/subscription/reactivate", {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong");
        return;
      }
      window.location.reload();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        onClick={handleReactivate}
        disabled={loading}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-wait disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {loading ? "Reactivating…" : "Reactivate Subscription"}
      </button>
      {error && (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
