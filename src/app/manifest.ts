import type { MetadataRoute } from "next";

/** Lets the browser install CronCal as an app: Safari's Add to Dock, Chrome's Install. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CronCal",
    short_name: "CronCal",
    description: "A calendar with repeats, drag to move and two-way Google Calendar sync, on your own database.",
    start_url: "/calendar",
    scope: "/",
    display: "standalone",
    background_color: "#1c1c1c",
    theme_color: "#1c1c1c",
    icons: [
      { src: "/icon/small", sizes: "192x192", type: "image/png" },
      { src: "/icon/large", sizes: "512x512", type: "image/png" },
    ],
  };
}
