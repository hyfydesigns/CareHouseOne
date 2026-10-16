import type { MetadataRoute } from "next";

/** Lets the home tablets install CareHouse One full-screen from the browser menu. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CareHouse One",
    short_name: "CareHouse",
    description: "Care records for group homes.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#edf3f4",
    theme_color: "#10323d",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
