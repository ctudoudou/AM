import { notFound } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { getKuraBuildRevision } from "@/lib/build-info";
import { isLocale } from "@/lib/i18n";
import { getMessages } from "@/messages";
import { OrganizerClient } from "./organizer-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function OrganizerPage({
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
      <AppSidebar activeKey="organizer" locale={locale} />
      <section className="settings-content">
        <header className="page-heading">
          <h1>{t.organizer}</h1>
          <p>{t.organizerDescription}</p>
        </header>
        <OrganizerClient buildRevision={getKuraBuildRevision()} locale={locale} />
      </section>
    </main>
  );
}
