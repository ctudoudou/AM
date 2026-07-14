import {
  Activity,
  CalendarDays,
  Download,
  Film,
  Folder,
  Home,
  Settings,
  ShieldCheck,
  Sparkles,
  Tv,
  WandSparkles,
} from "lucide-react";
import { getMessages } from "@/messages";
import type { Locale } from "@/lib/i18n";
import { StorageSummaryCard } from "@/components/storage-summary-card";
import { KuraIcon } from "@/components/kura-icon";
import { LibrarySearchDialog } from "@/components/library-search-dialog";

type SidebarKey =
  | "home"
  | "anime"
  | "animeCalendar"
  | "movies"
  | "tv"
  | "subscriptions"
  | "downloads"
  | "organizer"
  | "files"
  | "dataHealth"
  | "settings";

const navGroups = [
  {
    labelKey: "library",
    items: [
      { key: "home", icon: Home, href: "" },
      { key: "anime", icon: Sparkles, href: "/anime" },
      { key: "animeCalendar", icon: CalendarDays, href: "/anime-calendar" },
      { key: "movies", icon: Film, href: "/movies" },
      { key: "tv", icon: Tv, href: "/tv" },
    ],
  },
  {
    labelKey: "automation",
    items: [
      { key: "subscriptions", icon: Activity, href: "/subscriptions" },
      { key: "downloads", icon: Download, href: "/downloads" },
      { key: "organizer", icon: WandSparkles, href: "/organizer" },
    ],
  },
  {
    labelKey: "system",
    items: [
      { key: "files", icon: Folder, href: "/files" },
      { key: "dataHealth", icon: ShieldCheck, href: "/data-health" },
      { key: "settings", icon: Settings, href: "/settings" },
    ],
  },
] as const;

export function AppSidebar({
  locale,
  activeKey,
}: {
  locale: Locale;
  activeKey: SidebarKey;
}) {
  const t = getMessages(locale);

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <KuraIcon size={22} title={t.appName} />
        </div>
        <div>
          <strong>{t.appName}</strong>
          <span>
            <i />
            {t.online}
          </span>
        </div>
      </div>

      <LibrarySearchDialog locale={locale} />

      <nav aria-label={t.library} className="nav">
        {navGroups.map((group) => (
          <section key={group.labelKey}>
            <p>{t[group.labelKey]}</p>
            {group.items.map((item) => {
              const Icon = item.icon;
              const href = `/${locale}${item.href}`;

              return (
                <a
                  className={activeKey === item.key ? "active" : ""}
                  href={href}
                  key={item.key}
                >
                  <Icon size={16} />
                  <span>{t[item.key]}</span>
                </a>
              );
            })}
          </section>
        ))}
      </nav>

      <StorageSummaryCard
        availableLabel={t.available}
        storageLabel={t.storage}
        usedLabel={t.used}
      />
    </aside>
  );
}
