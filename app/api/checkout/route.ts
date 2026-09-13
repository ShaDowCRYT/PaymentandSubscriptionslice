import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { initiateCheckout } from "@/lib/subscription";
import { checkoutSchema } from "@/lib/schemas/subscription";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export async function POST(request: Request) {
  try {
    // Rate limit on checkout initiation (PRD requirement #9)
    const ip = await getClientIp();
    const rl = checkRateLimit(ip, "checkout", 5, 60_000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Too many requests. Retry after ${rl.retryAfterSeconds}s.` },
        { status: 429 }
      );
    }

    // Authenticate
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = checkoutSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    // Get user details for Flutterwave
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { email: true, fullName: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const result = await initiateCheckout(
      session.userId,
      parsed.data.plan,
      user.email,
      user.fullName
    );

    return NextResponse.json({
      paymentLink: result.paymentLink,
      txRef: result.txRef,
    });
  } catch (e) {
    console.error("Checkout error:", e);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
