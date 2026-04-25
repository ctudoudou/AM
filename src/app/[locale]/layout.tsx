import { notFound } from "next/navigation";
import { isLocale } from "@/lib/i18n";

export function generateStaticParams() {
  return [
    { locale: "en" },
    { locale: "zh-Hans" },
    { locale: "zh-Hant" },
    { locale: "ja" },
  ];
}

export default async function LocaleLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;

  if (!isLocale(locale)) {
    notFound();
  }

  return children;
}

