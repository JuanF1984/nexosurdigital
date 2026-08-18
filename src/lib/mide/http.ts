import { NextResponse } from "next/server";

export function mideOk<T extends object>(body: T, status = 200) {
  return NextResponse.json({ ok: true, ...body }, { status });
}

export function mideError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}
