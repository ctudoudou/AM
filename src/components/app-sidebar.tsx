import {
  Activity,
  Database,
  Download,
  Film,
  Folder,
  Home,
  Search,
  Settings,
  Sparkles,
  Tv,
  WandSparkles,
} from "lucide-react";
import { getMessages } from "@/messages";
import type { Locale } from "@/lib/i18n";
import { StorageSummaryCard } from "@/components/storage-summary-card";

type SidebarKey =
  | "home"
  | "anime"
  | "movies"
  | "tv"
  | "subscriptions"
  | "downloads"
  | "organizer"
  | "files"
  | "settings";

const navGroups = [
  {
    labelKey: "library",
    items: [
      { key: "home", icon: Home, href: "" },
      { key: "anime", icon: Sparkles, href: "/anime" },
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
          <Database size={16} />
        </div>
        <div>
          <strong>{t.appName}</strong>
          <span>
            <i />
            {t.online}
          </span>
        </div>
      </div>

      <button className="sidebar-search" type="button">
        <Search size={14} />
        <span>{t.search}</span>
        <kbd>⌘K</kbd>
      </button>

      <nav className="nav">
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
