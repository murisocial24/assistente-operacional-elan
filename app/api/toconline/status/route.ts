import { NextResponse } from "next/server";
import { isConnected } from "@/lib/toconline";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ ligado: isConnected() });
}
