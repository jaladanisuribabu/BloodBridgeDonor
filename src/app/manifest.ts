import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BloodBridge | Emergency Donor Coordination",
    short_name: "BloodBridge",
    description: "Secure hospital and patient blood availability services.",
    start_url: "/hospital",
    display: "standalone",
    background_color: "#f5f7f8",
    theme_color: "#c83a47",
    orientation: "any",
    icons: [
      {
        src: "/bloodbridge-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
