import { notFound } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { MediaLibraryClient } from "@/components/media-library-client";
import { isLocale } from "@/lib/i18n";
import { getMessages } from "@/messages";

export default async function MoviesPage({
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
      <AppSidebar activeKey="movies" locale={locale} />
      <section className="settings-content">
        <header className="page-heading">
          <h1>{t.moviesLibrary}</h1>
          <p>{t.moviesLibraryDescription}</p>
        </header>
        <MediaLibraryClient
          apiPath="/api/library/movies"
          emptyMessage={t.noMoviesTitles}
          locale={locale}
        />
      </section>
    </main>
  );
}
