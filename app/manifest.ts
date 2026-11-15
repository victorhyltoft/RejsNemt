import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Afsted",
    short_name: "Afsted",
    description: "Rejseplanlægger med live-kort",
    start_url: "/",
    display: "standalone",
    background_color: "#F3F4F7",
    theme_color: "#2F6BFF",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
