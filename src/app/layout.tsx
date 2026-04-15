import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dictation Reader",
  description: "Dictation reader for slow playback.",
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