import { notFound } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { isLocale } from "@/lib/i18n";
import { getMessages } from "@/messages";
import { FilesClient } from "./files-client";

export default async function FilesPage({
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
      <AppSidebar activeKey="files" locale={locale} />
      <section className="settings-content">
        <header className="page-heading">
          <h1>{t.files}</h1>
          <p>{t.filesDescription}</p>
        </header>
        <FilesClient locale={locale} />
      </section>
    </main>
  );
}
