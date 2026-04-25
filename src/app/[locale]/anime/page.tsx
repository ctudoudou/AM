import { notFound } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { isLocale } from "@/lib/i18n";
import { getMessages } from "@/messages";
import { AnimeLibraryClient } from "./anime-library-client";

export default async function AnimePage({
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
      <AppSidebar activeKey="anime" locale={locale} />
      <section className="settings-content">
        <header className="page-heading">
          <h1>{t.animeLibrary}</h1>
          <p>{t.animeLibraryDescription}</p>
        </header>
        <AnimeLibraryClient locale={locale} />
      </section>
    </main>
  );
}
