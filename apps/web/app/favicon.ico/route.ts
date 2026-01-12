import { NextRequest, NextResponse } from 'next/server';

// Avoid noisy 404s for browsers that probe /favicon.ico automatically.
// We serve a small SVG from /public and redirect here.
export function GET(request: NextRequest) {
  return NextResponse.redirect(new URL('/favicon.svg', request.url), 307);
}
