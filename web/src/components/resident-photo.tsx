/* eslint-disable @next/next/no-img-element -- the photo comes from an authenticated API route that must not be cached or optimised */

/** URL of a resident's photo, or null without one. The version makes a replaced photo load fresh. */
export function residentPhotoUrl(r: { id: string; photoUpdatedAt: Date | null }): string | null {
  return r.photoUpdatedAt ? `/api/residents/${r.id}/photo?v=${r.photoUpdatedAt.getTime()}` : null;
}

/**
 * A resident's photo in a circle, or their initials when there's no photo yet. Works in server and
 * client components (no hooks).
 */
export function ResidentPhoto({ src, name, size = 48 }: { src: string | null; name: string; size?: number }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38) };
  if (src) return <img className="avatar" src={src} alt={`Photo of ${name}`} width={size} height={size} style={style} />;
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .slice(0, 2)
    .join("");
  return (
    <span className="avatar" role="img" aria-label={`No photo of ${name} yet`} style={style}>
      {initials}
    </span>
  );
}
