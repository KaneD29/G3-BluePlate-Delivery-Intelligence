import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BluePlate · Delivery Intelligence",
  description: "Explore restaurant operations, delivery performance, pricing, and city intelligence with the interactive BluePlate dashboard.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
