import { ImageResponse } from "next/og";

/**
 * CronCal's mark: a calendar page in the app's accent on Midnight's page
 * colour, its top band and a week of days. Drawn at build in the two sizes a
 * browser asks of an installed app (the manifest names both), and used for
 * the tab too.
 */

export const contentType = "image/png";

const SIZES = { small: 192, large: 512 } as const;

export function generateImageMetadata() {
  return Object.entries(SIZES).map(([id, px]) => ({ id, size: { width: px, height: px }, contentType }));
}

export default async function Icon({ id }: { id: Promise<string> | string }) {
  const key = (await id) as keyof typeof SIZES;
  const px = SIZES[key] ?? SIZES.large;
  const page = Math.round(px * 0.6);
  const band = Math.round(page * 0.26);
  const dot = Math.round(page * 0.12);
  const gap = Math.round(page * 0.08);
  return new ImageResponse(
    (
      <div style={{ width: px, height: px, display: "flex", alignItems: "center", justifyContent: "center", background: "#1c1c1c", borderRadius: Math.round(px * 0.22) }}>
        <div style={{ width: page, height: page, borderRadius: Math.round(page * 0.16), background: "#2fa97f", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ height: band, background: "#ffffff", opacity: 0.92, display: "flex" }} />
          <div style={{ flex: 1, display: "flex", flexWrap: "wrap", alignContent: "center", justifyContent: "center", gap, padding: gap }}>
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} style={{ width: dot, height: dot, borderRadius: Math.round(dot * 0.25), background: "#ffffff", opacity: index === 4 ? 1 : 0.7 }} />
            ))}
          </div>
        </div>
      </div>
    ),
    { width: px, height: px },
  );
}
