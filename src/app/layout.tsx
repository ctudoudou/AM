import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kura",
  description: "Anime-first NAS media automation and playback.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hans">
      <body>{children}</body>
    </html>
  );
}

