import { notFound } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { isLocale } from "@/lib/i18n";
import { getMessages } from "@/messages";
import { SubscriptionsClient } from "./subscriptions-client";

export default async function SubscriptionsPage({
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
      <AppSidebar activeKey="subscriptions" locale={locale} />
      <section className="settings-content">
        <header className="page-heading">
          <h1>{t.subscriptions}</h1>
          <p>{t.subscriptionsDescription}</p>
        </header>
        <SubscriptionsClient locale={locale} />
      </section>
    </main>
  );
}
