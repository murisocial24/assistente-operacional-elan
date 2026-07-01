import { NextResponse } from "next/server";
import { isConnected, garantirRefreshCarregado } from "@/lib/moloni";

export const runtime = "nodejs";

export async function GET() {
  await garantirRefreshCarregado();
  return NextResponse.json({ ligado: isConnected() });
}
