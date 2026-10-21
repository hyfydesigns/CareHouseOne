/* eslint-disable @next/next/no-img-element -- the photo comes from an authenticated API route that must not be cached or optimised */

/** URL of a resident's photo, or null without one. The version makes a replaced photo load fresh. */
export function residentPhotoUrl(r: { id: string; photoUpdatedAt: Date | null }): string | null {
  return r.photoUpdatedAt ? `/api/residents/${r.id}/photo?v=${r.photoUpdatedAt.getTime()}` : null;
}

/** Background and text pairs for initials, so residents without a photo are easier to tell apart. */
const AVATAR_COLORS: Array<[string, string]> = [
  ["#eceafc", "#4334b8"],
  ["#ffe9db", "#934213"],
  ["#d9f3ea", "#0b5a46"],
  ["#fce4ee", "#8c2350"],
  ["#dfeefc", "#174f8f"],
  ["#fdf0d2", "#7a4f00"],
  ["#e8f6d9", "#3a6512"],
  ["#f1e4fb", "#64289a"],
];

/** The same name always gets the same color. */
function hash(s: string): number {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
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
  const [bg, ink] = AVATAR_COLORS[hash(name) % AVATAR_COLORS.length];
  return (
    <span className="avatar" role="img" aria-label={`No photo of ${name} yet`} style={{ ...style, "--av-bg": bg, "--av-ink": ink } as React.CSSProperties}>
      {initials}
    </span>
  );
}
