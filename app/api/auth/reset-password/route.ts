import { NextResponse } from "next/server";
import { resetPassword } from "@/lib/reset";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export async function POST(request: Request) {
  try {
    const ip = await getClientIp();
    const rl = checkRateLimit(ip, "reset-password", 5, 60_000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Too many requests. Retry after ${rl.retryAfterSeconds}s.` },
        { status: 429 }
      );
    }

    const body = await request.json();
    const result = await resetPassword(body);

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
