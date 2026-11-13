import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#c83a47",
};

export const metadata: Metadata = {
  title: "BloodBridge | Emergency Donor Coordination",
  description: "Hospital emergency blood donor matching and coordination.",
  applicationName: "BloodBridge",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "BloodBridge",
    statusBarStyle: "default",
  },
  icons: {
    icon: "/bloodbridge-icon.svg",
    apple: "/bloodbridge-icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
