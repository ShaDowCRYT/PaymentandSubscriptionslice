import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deriveEntitlementFromLog } from "@/lib/subscription";

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: { userId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { userId } = body;
  if (!userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }

  const sub = await prisma.subscription.findUnique({ where: { userId } });
  if (!sub) {
    return NextResponse.json({ error: "No subscription row for user" }, { status: 400 });
  }

  const originalPlan = sub.plan;
  const originalPeriodEnd = sub.currentPeriodEnd;

  // 1. Corrupt the cache column with a raw write to subscriptions.plan.
  await prisma.subscription.update({
    where: { userId },
    data: { plan: "FREE" },
  });

  const corruptedReadback = await prisma.subscription.findUnique({
    where: { userId },
    select: { plan: true, currentPeriodEnd: true },
  });

  // 2. Log-derived entitlement — must ignore the corrupted cache.
  const derived = await deriveEntitlementFromLog(userId);

  // 3. Restore the cache to its original value.
  const restored = await prisma.subscription.update({
    where: { userId },
    data: { plan: originalPlan, currentPeriodEnd: originalPeriodEnd },
  });

  const derivedPeriodIso = derived.currentPeriodEnd?.toISOString() ?? null;
  const originalPeriodIso = originalPeriodEnd?.toISOString() ?? null;

  return NextResponse.json({
    userId,
    cacheBefore: { plan: originalPlan, currentPeriodEnd: originalPeriodIso },
    corruptedCache: {
      plan: corruptedReadback?.plan ?? null,
      currentPeriodEnd:
        corruptedReadback?.currentPeriodEnd?.toISOString() ?? null,
    },
    logDerived: { plan: derived.plan, currentPeriodEnd: derivedPeriodIso },
    cacheRestored: {
      plan: restored.plan,
      currentPeriodEnd: restored.currentPeriodEnd?.toISOString() ?? null,
    },
    result:
      derived.plan === originalPlan &&
      derivedPeriodIso === originalPeriodIso
        ? "PASS — derived entitlement unaffected by corrupted subscriptions.plan"
        : "FAIL — derived entitlement does not match what was actually paid",
  });
}