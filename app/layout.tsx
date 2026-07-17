import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Jikmis Apartment",
    template: "%s | Jikmis Apartment"
  },
  description:
    "Luxury serviced apartments in Boudha, Kathmandu with studio rooms, family rooms, direct booking, and AI receptionist support."
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
