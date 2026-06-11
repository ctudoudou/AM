import { notFound } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { isLocale } from "@/lib/i18n";
import { getMessages } from "@/messages";
import { AnimeCalendarClient } from "./anime-calendar-client";

export default async function AnimeCalendarPage({
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
      <AppSidebar activeKey="animeCalendar" locale={locale} />
      <section className="settings-content">
        <header className="page-heading">
          <h1>{t.animeCalendar}</h1>
          <p>{t.animeCalendarDescription}</p>
        </header>
        <AnimeCalendarClient locale={locale} />
      </section>
    </main>
  );
}
