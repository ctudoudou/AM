import { notFound } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { MediaLibraryClient } from "@/components/media-library-client";
import { isLocale } from "@/lib/i18n";
import { getMessages } from "@/messages";

export default async function TvPage({
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
      <AppSidebar activeKey="tv" locale={locale} />
      <section className="settings-content">
        <header className="page-heading">
          <h1>{t.tvLibrary}</h1>
          <p>{t.tvLibraryDescription}</p>
        </header>
        <MediaLibraryClient
          apiPath="/api/library/tv"
          detailBasePath="/tv"
          emptyMessage={t.noTvTitles}
          locale={locale}
          mediaType="TV"
        />
      </section>
    </main>
  );
}
