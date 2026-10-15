import type { Metadata } from "next";
import "./fonts/hanken-grotesk.css";
import "./globals.css";
import { contentPaletteCss } from "@/lib/content-palette";
import { DOCUMENT_SCROLL_CSS } from "@/lib/document-scroll-rules";
import { APP_FIRST_PAINT } from "@/lib/first-paint";
import { LIGHT_THEMES, THEME_VALUES } from "@/lib/themes";
import { ConfigProvider } from "@/selfhost/ConfigProvider";
import SetupGate from "@/selfhost/SetupGate";
import { browserHalf, readAppConfig } from "@/selfhost/config";
import { APP_NAME } from "@/selfhost/constants";

/* Read on every request: the project is connected after the build. */
export const dynamic = "force-dynamic";

/*
 * Spelled here because lib/theme is a client module, whose constants reach a
 * server component as references, not values. scripts/first-paint.test.mjs
 * keeps the two equal.
 */
const THEME_KEY = "theme";

/**
 * Runs before first paint, so a reload never flashes the wrong theme: it
 * sets the stored theme on <html> and paints that theme's page colour inline
 * (lib/first-paint), since the stylesheet may not have arrived yet. The colour
 * is handed back to the stylesheet once the page has loaded.
 */
const themeInitializer = `
  (() => {
    try {
      const root = document.documentElement;
      const theme = window.localStorage.getItem(${JSON.stringify(THEME_KEY)});
      if (${JSON.stringify(THEME_VALUES.filter((value) => value !== "midnight"))}.includes(theme)) {
        root.setAttribute("data-theme", theme);
      } else {
        root.removeAttribute("data-theme");
      }
      const paint = ${JSON.stringify(APP_FIRST_PAINT)};
      root.style.backgroundColor = paint[theme] || paint.midnight;
      root.style.colorScheme = ${JSON.stringify(LIGHT_THEMES)}.includes(theme) ? "light" : "dark";
      window.addEventListener("load", () => {
        root.style.removeProperty("background-color");
        root.style.removeProperty("color-scheme");
      }, { once: true });
    } catch {}
  })();
`;

export const metadata: Metadata = {
  title: APP_NAME,
  description: "A calendar with repeats, drag to move and two-way Google Calendar sync, on your own database.",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // A config that cannot be read is the status route's to explain; the page still draws.
  const config = browserHalf(await readAppConfig().catch(() => null));
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script id="croncal-theme-initializer" dangerouslySetInnerHTML={{ __html: themeInitializer }} />
        <style id="croncal-document-scroll" dangerouslySetInnerHTML={{ __html: DOCUMENT_SCROLL_CSS }} />
        {/* Each theme's content colours (lib/content-palette), with the page that reads them. */}
        <style id="croncal-content-palette" dangerouslySetInnerHTML={{ __html: contentPaletteCss() }} />
      </head>
      <body style={{ display: "flex", flexDirection: "column" }} suppressHydrationWarning>
        <ConfigProvider config={config}>
          <SetupGate>{children}</SetupGate>
        </ConfigProvider>
      </body>
    </html>
  );
}
