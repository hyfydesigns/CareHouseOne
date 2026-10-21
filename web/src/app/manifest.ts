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
    background_color: "#f5f5fb",
    theme_color: "#5b4bdb",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
