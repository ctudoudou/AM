import { PgBoss } from "pg-boss";
import { getAppSettings } from "@/lib/settings";
import { runJob, type JobName } from "@/lib/jobs";

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://kura:kura@localhost:5432/kura?schema=public";

const boss = new PgBoss({ connectionString });

async function main() {
  await boss.start();

  for (const name of [
    "rss.fetchAll",
    "rss.parseItems",
    "ai.groupCandidates",
    "subscriptions.matchNewCandidates",
    "downloads.syncAria2",
    "organizer.inspectCompletedDownloads",
    "library.scan",
  ] as JobName[]) {
    await boss.work(name, async () => runJob(name));
  }

  const settings = await getAppSettings();
  await boss.schedule("rss.fetchAll", "*/5 * * * *", {});
  await boss.schedule("downloads.syncAria2", "*/1 * * * *");

  console.log(
    `Kura worker started. Subscription frequency: ${settings.general.subscriptionFrequencyMinutes} minutes.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
