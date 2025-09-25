import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "FreyaRebecca",
  description: "Admin & Chat UI",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      {/* Системные шрифты, без next/font/google */}
      <body className="antialiased">{children}</body>
    </html>
  );
}
