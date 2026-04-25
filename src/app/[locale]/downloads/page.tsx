import { notFound } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { isLocale } from "@/lib/i18n";
import { getMessages } from "@/messages";
import { DownloadsClient } from "./downloads-client";

export default async function DownloadsPage({
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
      <AppSidebar activeKey="downloads" locale={locale} />
      <section className="settings-content">
        <header className="page-heading">
          <h1>{t.downloads}</h1>
          <p>{t.downloadsDescription}</p>
        </header>
        <DownloadsClient locale={locale} />
      </section>
    </main>
  );
}
