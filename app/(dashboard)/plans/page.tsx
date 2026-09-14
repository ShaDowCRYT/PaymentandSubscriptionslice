import { getSession } from "@/lib/session";
import {
  getOrCreateSubscription,
  deriveEntitlementFromLog,
} from "@/lib/subscription";
import { redirect } from "next/navigation";
import PlansClient from "./plans-client";

export default async function PlansPage() {
  const session = await getSession();
  if (!session) redirect("/signin");

  const sub = await getOrCreateSubscription(session.userId);
  const entitlement = await deriveEntitlementFromLog(session.userId);

  return (
    <div>
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
        Plans
      </h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Choose the plan that works for you.
      </p>

      <div className="mt-8">
        <PlansClient
          currentPlan={entitlement.plan}
          cancelAtPeriodEnd={sub.cancelAtPeriodEnd}
          pendingDowngradeTo={sub.pendingDowngradeTo}
        />
      </div>
    </div>
  );
}
