import { NextResponse } from "next/server";
import { authUrl } from "@/lib/zoho";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.redirect(authUrl());
}
