import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BlogPilot",
  description: "Multi-site AI blogging operations platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
