import { notFound } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { isLocale } from "@/lib/i18n";
import { HomeDashboardClient } from "./home-dashboard-client";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!isLocale(locale)) {
    notFound();
  }

  return (
    <main className="app-shell">
      <AppSidebar activeKey="home" locale={locale} />
      <HomeDashboardClient locale={locale} />
    </main>
  );
}
