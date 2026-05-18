import { PgBoss } from "pg-boss";
import { getAppSettings } from "@/lib/settings";
import { type JobName } from "@/lib/jobs";
import { listJobRuns, runJobWithLog } from "@/lib/job-runs";

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://kura:change-me@localhost:5432/kura?schema=public";

const boss = new PgBoss({ connectionString });

async function main() {
  boss.on("error", (error) => {
    console.error(error);
  });

  await boss.start();

  const queues = [
    "rss.fetchAll",
    "rss.parseItems",
    "ai.groupCandidates",
    "subscriptions.matchNewCandidates",
    "downloads.syncAria2",
    "organizer.inspectCompletedDownloads",
    "organizer.autoExecuteReadyPlans",
    "library.scan",
  ] as JobName[];

  for (const name of queues) {
    await boss.createQueue(name);
  }

  for (const name of queues) {
    await boss.work<{ scheduled?: boolean }>(name, async (jobs) => {
      const isScheduledRun = jobs.some((job) => job.data?.scheduled);
      if (name === "rss.fetchAll" && isScheduledRun) {
        return runScheduledRssFetch();
      }
      if (name === "downloads.syncAria2" && isScheduledRun) {
        return runJobWithLog(name, {
          shouldLogSuccess: (result) =>
            Boolean(
              result &&
                typeof result === "object" &&
                "synced" in result &&
                Number((result as { synced: unknown }).synced) > 0,
            ),
        });
      }
      if (name === "organizer.autoExecuteReadyPlans" && isScheduledRun) {
        return runJobWithLog(name, {
          shouldLogSuccess: (result) =>
            Boolean(
              result &&
                typeof result === "object" &&
                "executed" in result &&
                Number((result as { executed: unknown }).executed) > 0,
            ),
        });
      }
      return runJobWithLog(name);
    });
  }

  const settings = await getAppSettings();
  await boss.unschedule("rss.fetchAll").catch(() => null);
  await boss.unschedule("downloads.syncAria2").catch(() => null);
  await boss.unschedule("organizer.autoExecuteReadyPlans").catch(() => null);
  await boss.schedule("rss.fetchAll", "*/5 * * * *", { scheduled: true });
  await boss.schedule("downloads.syncAria2", "*/1 * * * *", { scheduled: true });
  await boss.schedule("organizer.autoExecuteReadyPlans", "*/2 * * * *", { scheduled: true });

  console.log(
    `Kura worker started. RSS frequency: ${settings.general.subscriptionFrequencyMinutes} minutes; download sync: */1 * * * *; auto organizer: */2 * * * *.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function runScheduledRssFetch() {
  const settings = await getAppSettings();
  const frequencyMs = settings.general.subscriptionFrequencyMinutes * 60_000;
  const lastSuccess = (await listJobRuns(120)).find(
    (run) => run.job === "rss.fetchAll" && run.status === "SUCCESS",
  );
  const elapsedMs = lastSuccess
    ? Date.now() - Date.parse(lastSuccess.finishedAt)
    : Number.POSITIVE_INFINITY;

  if (elapsedMs < frequencyMs) {
    return {
      skipped: true,
      reason: "RSS frequency window has not elapsed.",
      nextRunAfter: new Date(Date.parse(lastSuccess?.finishedAt ?? "") + frequencyMs).toISOString(),
    };
  }

  return runJobWithLog("rss.fetchAll");
}
