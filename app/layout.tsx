import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "./auth-provider";
import { PwaRegister } from "./pwa-register";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Recetulis Cósmicas",
  description:
    "Encontrá recetas según lo que tenés y guardá tu colección personal.",
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Recetulis", statusBarStyle: "default" },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/icon-192.png",
  },
  other: {
    "codex-preview": "development",
  },
};

export const viewport: Viewport = {
  themeColor: "#6f2b3d",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <AuthProvider>{children}</AuthProvider>
        <PwaRegister />
      </body>
    </html>
  );
}
