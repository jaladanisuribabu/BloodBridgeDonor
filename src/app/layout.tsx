import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BloodBridge | Emergency Donor Coordination",
  description: "Hospital emergency blood donor matching and coordination.",
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
