import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dictation Reader",
  description: "Structured dictation reader for slow, accessible playback.",
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