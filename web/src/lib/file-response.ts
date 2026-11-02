import { NextResponse } from "next/server";

/**
 * A stored photo or PDF as a response: never cached, opened in the browser's own viewer with
 * nothing in it allowed to run, or saved with `download`.
 */
export function fileResponse(f: { data: Uint8Array; contentType: string; filename: string }, download: boolean): NextResponse {
  return new NextResponse(new Uint8Array(f.data), {
    headers: {
      "Content-Type": f.contentType,
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${f.filename.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
