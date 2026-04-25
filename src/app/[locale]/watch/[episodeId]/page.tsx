import { notFound } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { prisma } from "@/lib/db";
import { isLocale } from "@/lib/i18n";
import { getMessages } from "@/messages";
import { WatchClient } from "./watch-client";

const directPlayExtensions = new Set([".mp4", ".m4v", ".webm", ".mov"]);

export default async function WatchPage({
  params,
}: {
  params: Promise<{ locale: string; episodeId: string }>;
}) {
  const { locale, episodeId } = await params;

  if (!isLocale(locale)) {
    notFound();
  }

  const episode = await prisma.episode.findUnique({
    where: { id: episodeId },
    include: {
      files: { orderBy: { updatedAt: "desc" } },
      progress: true,
      season: { include: { media: true } },
    },
  });

  if (!episode || episode.files.length === 0) {
    notFound();
  }

  const t = getMessages(locale);
  const file = selectPlayableFile(episode.files);

  return (
    <main className="app-shell">
      <AppSidebar activeKey="anime" locale={locale} />
      <section className="watch-content">
        <header className="watch-heading">
          <div>
            <p>{episode.season.media.primaryTitle}</p>
            <h1>
              S{String(episode.season.number).padStart(2, "0")}E
              {String(episode.number).padStart(2, "0")} ·{" "}
              {episode.title || t.unknownTitle}
            </h1>
          </div>
          <a href={`/${locale}/anime`}>{t.backToLibrary}</a>
        </header>
        <WatchClient
          episodeId={episode.id}
          initialPositionSec={episode.progress[0]?.positionSec ?? 0}
          locale={locale}
          mediaFileId={file.id}
        />
      </section>
    </main>
  );
}

function selectPlayableFile<T extends { absolutePath: string }>(files: T[]) {
  return (
    files.find((file) => directPlayExtensions.has(extname(file.absolutePath))) ??
    files[0]
  );
}

function extname(filePath: string) {
  const index = filePath.lastIndexOf(".");
  return index >= 0 ? filePath.slice(index).toLowerCase() : "";
}
