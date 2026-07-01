import { NextResponse } from "next/server";
import { isConnected } from "@/lib/zoho";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ ligado: isConnected() });
}
