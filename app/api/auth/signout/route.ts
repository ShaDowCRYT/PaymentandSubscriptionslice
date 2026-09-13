import { NextResponse } from "next/server";
import { deleteSession } from "@/lib/session";

export async function POST() {
  try {
    await deleteSession();
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
