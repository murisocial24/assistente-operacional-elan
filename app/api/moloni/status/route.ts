import { NextResponse } from "next/server";
import { isConnected } from "@/lib/moloni";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ ligado: isConnected() });
}
