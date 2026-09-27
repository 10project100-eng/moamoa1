import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "모아봄 — 사고 싶은 것 보관함",
  description: "다시 찾기 어려워지기 전에 사고 싶은 패션과 아이템 링크, 캡처를 한곳에 모아두세요.",
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
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
