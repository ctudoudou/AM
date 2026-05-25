import { notFound } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { isLocale } from "@/lib/i18n";
import { getMessages } from "@/messages";
import { DataHealthClient } from "./data-health-client";

export default async function DataHealthPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!isLocale(locale)) {
    notFound();
  }

  const t = getMessages(locale);

  return (
    <main className="app-shell">
      <AppSidebar activeKey="dataHealth" locale={locale} />
      <section className="settings-content">
        <header className="page-heading">
          <h1>{t.dataHealth}</h1>
          <p>{t.dataHealthDescription}</p>
        </header>
        <DataHealthClient locale={locale} />
      </section>
    </main>
  );
}
