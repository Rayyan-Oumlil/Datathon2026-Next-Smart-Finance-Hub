import { NextResponse } from "next/server";

// Load balancer health check: answers without touching any provider or table.
export function GET() {
    return NextResponse.json({ ok: true });
}
