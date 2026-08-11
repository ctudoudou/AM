"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Check,
  CheckCheck,
  FolderSearch,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  WandSparkles,
  X,
} from "lucide-react";
import { getMessages } from "@/messages";
import type { Locale } from "@/lib/i18n";
import {
  ORGANIZER_PLAN_EXECUTION_CONFIRMATION,
  ORGANIZER_OPERATION_ROLLBACK_CONFIRMATION,
  ORGANIZER_REPAIR_CONFIRMATION,
  ORGANIZER_AI_CLASSIFICATION_CONFIRMATION,
} from "@/lib/organizer-confirmations";
import type { OrganizerRepairPlan } from "@/lib/organizer-repair";

type OrganizerAiFileRole =
  | "MAIN_VIDEO"
  | "EXTRA_VIDEO"
  | "AUDIO"
  | "IMAGE"
  | "METADATA"
  | "UNRELATED";

type OrganizerPlan = {
  id: string;
  version: string;
  mediaType: "ANIME" | "MOVIE" | "TV";
  status: string;
  confidence: number;
  reason?: string | null;
  autoExecutable: boolean;
  automation?: {
    executable: boolean;
    autoExecutable: boolean;
    reasons: string[];
  };
  candidate?: {
    parsedTitle: string;
    group?: { displayTitle: string } | null;
  } | null;
  items: Array<{
    id: string;
    sourcePath: string;
    targetPath: string;
    fileType: string;
    conflict: boolean;
    conflictReason?: string | null;
  }>;
  metadata?: {
    title?: string;
    posterUrl?: string;
    year?: number;
    aiReview?: {
      riskLevel: "OK" | "REVIEW" | "REJECT";
      confidence: number;
      summary: string;
      acceptedItems: number;
      rejectedItems: number;
      appliedAt?: string;
      fileClassifications: Array<{
        sourcePath: string;
        role: OrganizerAiFileRole;
        mediaType: string | null;
        title: string | null;
        season: number | null;
        episodeNumber: number | null;
        confidence: number;
        evidence: string;
      }>;
    };
  } | null;
};

type OrganizerSettings = {
  directories: {
    importRoot: string;
  };
};

type OrganizerOperationRecord = {
  id: string;
  action: string;
  status: string;
  entityId?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  rollbackData?: {
    moves?: Array<{ sourcePath: string; targetPath: string }>;
  } | null;
};

const organizerViewFilters = [
  "ACTIVE",
  "AUTO_READY",
  "HISTORY",
  "ALL",
] as const;

const organizerStatusFilters = [
  "PENDING",
  "NEEDS_REVIEW",
  "EXECUTING",
  "CONFLICT",
  "FAILED",
  "EXECUTED",
  "REJECTED",
  "AUTO_ARCHIVED",
] as const;

type OrganizerFilter = (typeof organizerViewFilters)[number] | (typeof organizerStatusFilters)[number];

type OrganizerStats = {
  active: number;
  autoExecutable: number;
  all: number;
  byStatus: Record<string, number | undefined>;
};

type OrganizerPage = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
};

type PlanAction = "execute" | "reject" | "regenerate" | "ai-review" | "ai-apply";

export function OrganizerClient({
  buildRevision,
  locale,
}: {
  buildRevision: string;
  locale: Locale;
}) {
  const t = getMessages(locale);
  const searchParams = useSearchParams();
  const linkedPlanId = searchParams.get("planId")?.trim() || null;
  const [plans, setPlans] = useState<OrganizerPlan[]>([]);
  const [operations, setOperations] = useState<OrganizerOperationRecord[]>([]);
  const [stats, setStats] = useState<OrganizerStats | null>(null);
  const [filter, setFilter] = useState<OrganizerFilter>(
    searchParams.get("view") === "all" ? "ALL" : "ACTIVE",
  );
  const [planPage, setPlanPage] = useState(1);
  const [pageInfo, setPageInfo] = useState<OrganizerPage>({
    page: 1,
    pageSize: 50,
    total: 0,
    totalPages: 1,
    hasNext: false,
    hasPrevious: false,
  });
  const [importDraft, setImportDraft] = useState({ root: "", mediaType: "AUTO" });
  const [importing, setImporting] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [autoExecuting, setAutoExecuting] = useState(false);
  const [repairLoading, setRepairLoading] = useState(false);
  const [repairExecuting, setRepairExecuting] = useState(false);
  const [repairPlan, setRepairPlan] = useState<OrganizerRepairPlan | null>(null);
  const [repairSelection, setRepairSelection] = useState<string[]>([]);
  const [pendingExecution, setPendingExecution] = useState<OrganizerPlan | null>(null);
  const [executionAcknowledged, setExecutionAcknowledged] = useState(false);
  const [pendingRollback, setPendingRollback] = useState<OrganizerOperationRecord | null>(null);
  const [rollbackAcknowledged, setRollbackAcknowledged] = useState(false);
  const [rollbackBusy, setRollbackBusy] = useState(false);
  const [planAction, setPlanAction] = useState<{ id: string; action: PlanAction } | null>(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const loadRequestId = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++loadRequestId.current;
    setRefreshing(true);
    try {
      const [body, operationBody] = await Promise.all([
        requestJson<{
          plans: OrganizerPlan[];
          stats?: OrganizerStats;
          page?: OrganizerPage;
        }>(
          `/api/organizer/plans?${organizerPlanParams(filter, planPage, linkedPlanId)}`,
          undefined,
          t.organizerLoadError,
          { DATABASE_MIGRATION_REQUIRED: t.databaseMigrationRequired },
        ),
        requestJson<{ operations: OrganizerOperationRecord[] }>(
          "/api/operations?domain=ORGANIZER&limit=15",
          undefined,
          t.organizerLoadError,
        ).catch(() => null),
      ]);
      if (requestId !== loadRequestId.current) {
        return;
      }
      if (body.page && body.page.page > body.page.totalPages) {
        setPlanPage(body.page.totalPages);
        return;
      }
      setPlans(body.plans);
      if (operationBody) {
        setOperations(operationBody.operations);
      }
      setStats(body.stats ?? null);
      setPageInfo(
        body.page ?? {
          page: 1,
          pageSize: body.plans.length || 50,
          total: body.plans.length,
          totalPages: 1,
          hasNext: false,
          hasPrevious: false,
        },
      );
      setError("");
    } catch (loadError) {
      if (requestId === loadRequestId.current) {
        setError(loadError instanceof Error ? loadError.message : t.organizerLoadError);
      }
    } finally {
      if (requestId === loadRequestId.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [filter, linkedPlanId, planPage, t.databaseMigrationRequired, t.organizerLoadError]);

  const loadImportRoot = useCallback(async () => {
    try {
      const body = await requestJson<OrganizerSettings>(
        "/api/settings",
        undefined,
        t.organizerLoadError,
      );
      setImportDraft((current) => ({
        ...current,
        root: current.root.trim() ? current.root : body.directories.importRoot,
      }));
    } catch {
      // The configured import path is optional context; the organizer list can still be used.
    }
  }, [t.organizerLoadError]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  useEffect(() => {
    if (!linkedPlanId || !plans.some((plan) => plan.id === linkedPlanId)) {
      return;
    }
    document.getElementById(`organizer-plan-${linkedPlanId}`)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [linkedPlanId, plans]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadImportRoot();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadImportRoot]);

  useEffect(() => {
    if (!pendingExecution && !pendingRollback && !repairPlan) {
      return;
    }
    function closeDialog(event: KeyboardEvent) {
      if (event.key !== "Escape" || planAction || repairExecuting || rollbackBusy) {
        return;
      }
      setPendingExecution(null);
      setExecutionAcknowledged(false);
      setPendingRollback(null);
      setRollbackAcknowledged(false);
      setRepairPlan(null);
      setRepairSelection([]);
    }
    window.addEventListener("keydown", closeDialog);
    return () => window.removeEventListener("keydown", closeDialog);
  }, [
    pendingExecution,
    pendingRollback,
    planAction,
    repairExecuting,
    repairPlan,
    rollbackBusy,
  ]);

  async function runInspect() {
    setInspecting(true);
    setStatus("");
    setError("");
    try {
      await requestJson(
        "/api/jobs/run",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ job: "organizer.inspectCompletedDownloads" }),
        },
        t.organizerLoadError,
      );
      setStatus(t.inspectCompletedDone);
      await load();
    } catch (inspectError) {
      setError(errorMessage(inspectError, t.organizerLoadError));
    } finally {
      setInspecting(false);
    }
  }

  async function runAiReview() {
    setReviewing(true);
    setStatus("");
    setError("");
    try {
      const body = await requestJson<{
        result?: { reviewed?: number; filteredItems?: number; flagged?: number; skipped?: number };
      }>(
        "/api/jobs/run",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ job: "organizer.aiReviewPlans" }),
        },
        t.aiReviewPlansError,
      );
      setStatus(
        `${t.aiReviewPlansDone} ${t.organizerReviewed}: ${body.result?.reviewed ?? 0}, ${t.organizerFiltered}: ${body.result?.filteredItems ?? 0}, ${t.organizerFlagged}: ${body.result?.flagged ?? 0}, ${t.organizerSkipped}: ${body.result?.skipped ?? 0}.`,
      );
      await load();
    } catch (reviewError) {
      setError(errorMessage(reviewError, t.aiReviewPlansError));
    } finally {
      setReviewing(false);
    }
  }

  async function reviewPlanWithAi(plan: OrganizerPlan) {
    if (!canAiReviewPlan(plan)) {
      setError(t.organizerAiClassifyUnavailable);
      return;
    }
    setPlanAction({ id: plan.id, action: "ai-review" });
    setStatus("");
    setError("");
    try {
      const body = await requestJson<{
        review: { riskLevel: "OK" | "REVIEW" | "REJECT"; confidence: number; summary: string };
        acceptedItems: number;
        filteredItems: number;
        flagged: boolean;
        remainingItems: number;
        unclassifiedItems: number;
      }>(
        `/api/organizer/plans/${plan.id}/ai-review`,
        { method: "POST" },
        t.aiReviewPlansError,
        {
          ORGANIZER_AI_REVIEW_UNAVAILABLE: t.organizerAiClassifyUnavailable,
          ORGANIZER_AI_REVIEW_NOT_SUPPORTED: t.organizerAiClassifyUnavailable,
          ORGANIZER_AI_REVIEW_TOO_LARGE: t.organizerAiClassifyTooLarge,
        },
      );
      setStatus(
        `${t.organizerAiClassifyDone} ${formatOrganizerAiRisk(body.review.riskLevel, t)} · ${Math.round(body.review.confidence * 100)}%${body.filteredItems > 0 ? ` · ${t.organizerAiFiltered}: ${body.filteredItems}` : ""}`,
      );
      await load();
    } catch (reviewError) {
      setError(errorMessage(reviewError, t.aiReviewPlansError));
    } finally {
      setPlanAction(null);
    }
  }

  async function applyPlanAiClassification(plan: OrganizerPlan) {
    if (!canApplyAiClassification(plan)) {
      setError(t.organizerAiApplyUnavailable);
      return;
    }
    setPlanAction({ id: plan.id, action: "ai-apply" });
    setStatus("");
    setError("");
    try {
      const body = await requestJson<{
        updatedItems: number;
        excludedItems: number;
        conflicts: number;
      }>(
        `/api/organizer/plans/${plan.id}/ai-review/apply`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            confirmation: ORGANIZER_AI_CLASSIFICATION_CONFIRMATION,
            planVersion: plan.version,
          }),
        },
        t.organizerAiApplyError,
        {
          ORGANIZER_AI_REVIEW_NOT_SUPPORTED: t.organizerAiApplyUnavailable,
          STALE_ORGANIZER_PLAN: t.organizerPlanStale,
        },
      );
      setStatus(
        `${t.organizerAiApplyDone} ${t.organizerUpdated}: ${body.updatedItems}, ${t.organizerExcluded}: ${body.excludedItems}, ${t.conflict}: ${body.conflicts}.`,
      );
      await load();
    } catch (applyError) {
      setError(errorMessage(applyError, t.organizerAiApplyError));
    } finally {
      setPlanAction(null);
    }
  }

  async function runAutoExecute() {
    setAutoExecuting(true);
    setStatus("");
    setError("");
    try {
      const body = await requestJson<{
        result?: { inspected?: number; executed?: number; skipped?: number; failed?: number };
      }>(
        "/api/jobs/run",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ job: "organizer.autoExecuteReadyPlans" }),
        },
        t.autoExecuteOrganizerPlansError,
      );
      setStatus(
        `${t.autoExecuteOrganizerPlansDone} ${t.organizerInspected}: ${body.result?.inspected ?? 0}, ${t.organizerExecuted}: ${body.result?.executed ?? 0}, ${t.organizerSkipped}: ${body.result?.skipped ?? 0}, ${t.organizerFailed}: ${body.result?.failed ?? 0}.`,
      );
      await load();
    } catch (executeError) {
      setError(errorMessage(executeError, t.autoExecuteOrganizerPlansError));
    } finally {
      setAutoExecuting(false);
    }
  }

  async function openRepairPlan() {
    setRepairLoading(true);
    setStatus("");
    setError("");
    try {
      const plan = await requestJson<OrganizerRepairPlan>(
        "/api/organizer/repair",
        undefined,
        t.repairOrganizerPipelineError,
      );
      setRepairPlan(plan);
      setRepairSelection(
        plan.items
          .filter((item) => item.executable && item.confidence === "high")
          .map((item) => item.actionId),
      );
    } catch (repairError) {
      setError(errorMessage(repairError, t.repairOrganizerPipelineError));
    } finally {
      setRepairLoading(false);
    }
  }

  async function executeRepairPlan() {
    if (!repairPlan || repairSelection.length === 0) {
      return;
    }
    setRepairExecuting(true);
    setStatus("");
    setError("");
    try {
      const body = await requestJson<{
        succeeded: number;
        failed: number;
      }>(
        "/api/organizer/repair",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            planId: repairPlan.planId,
            actionIds: repairSelection,
            confirmation: ORGANIZER_REPAIR_CONFIRMATION,
          }),
        },
        t.repairOrganizerPipelineError,
      );
      setStatus(
        `${t.repairOrganizerPipelineDone} ${t.organizerSucceeded}: ${body.succeeded}, ${t.organizerFailed}: ${body.failed}.`,
      );
      setRepairPlan(null);
      setRepairSelection([]);
      await load();
    } catch (repairError) {
      setError(errorMessage(repairError, t.repairOrganizerPipelineError));
    } finally {
      setRepairExecuting(false);
    }
  }

  async function runImportScan() {
    setImporting(true);
    setError("");
    setStatus("");
    try {
      const body = await requestJson<{
        planned: number;
        skipped: number;
        lowConfidence: number;
      }>(
        "/api/organizer/import-scan",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(importDraft),
        },
        t.importScanError,
      );
      setStatus(
        `${t.importScanCreated} ${t.importScanPlanned}: ${body.planned}, ${t.importScanSkipped}: ${body.skipped}, ${t.importScanReview}: ${body.lowConfidence}.`,
      );
      await load();
    } catch (importError) {
      setError(errorMessage(importError, t.importScanError));
    } finally {
      setImporting(false);
    }
  }

  function requestExecution(plan: OrganizerPlan) {
    if (!canExecutePlan(plan)) {
      setError(t.organizerExecuteError);
      return;
    }
    setStatus("");
    setError("");
    setExecutionAcknowledged(false);
    setPendingExecution(plan);
  }

  async function execute(plan: OrganizerPlan) {
    if (!canExecutePlan(plan) || !executionAcknowledged) {
      setError(t.organizerExecutionAcknowledgeRequired);
      return;
    }
    setPlanAction({ id: plan.id, action: "execute" });
    setStatus("");
    setError("");
    try {
      await requestJson(
        `/api/organizer/plans/${plan.id}/execute`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            confirmation: ORGANIZER_PLAN_EXECUTION_CONFIRMATION,
            clientRevision: buildRevision,
            planVersion: plan.version,
          }),
        },
        t.organizerExecuteError,
      );
      setPendingExecution(null);
      setExecutionAcknowledged(false);
      setStatus(t.organizerExecuteDone);
      await load();
    } catch (executeError) {
      setError(errorMessage(executeError, t.organizerExecuteError));
    } finally {
      setPlanAction(null);
    }
  }

  async function reject(plan: OrganizerPlan) {
    setPlanAction({ id: plan.id, action: "reject" });
    setStatus("");
    setError("");
    try {
      await requestJson(
        `/api/organizer/plans/${plan.id}/reject`,
        { method: "POST" },
        t.organizerRejectError,
      );
      setStatus(t.organizerRejectDone);
      await load();
    } catch (rejectError) {
      setError(errorMessage(rejectError, t.organizerRejectError));
    } finally {
      setPlanAction(null);
    }
  }

  async function regenerate(plan: OrganizerPlan) {
    setPlanAction({ id: plan.id, action: "regenerate" });
    setStatus("");
    setError("");
    try {
      await requestJson(
        `/api/organizer/plans/${plan.id}/regenerate`,
        { method: "POST" },
        t.organizerRegenerateError,
      );
      setStatus(t.organizerRegenerateDone);
      await load();
    } catch (regenerateError) {
      setError(errorMessage(regenerateError, t.organizerRegenerateError));
    } finally {
      setPlanAction(null);
    }
  }

  async function rollbackOrganizerOperation(operation: OrganizerOperationRecord) {
    if (!rollbackAcknowledged) {
      setError(t.organizerRollbackAcknowledgeRequired);
      return;
    }
    setRollbackBusy(true);
    setStatus("");
    setError("");
    try {
      await requestJson(
        `/api/operations/${operation.id}/rollback`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            confirmation: ORGANIZER_OPERATION_ROLLBACK_CONFIRMATION,
          }),
        },
        t.organizerRollbackError,
      );
      setPendingRollback(null);
      setRollbackAcknowledged(false);
      setStatus(t.organizerRollbackDone);
      await load();
    } catch (rollbackError) {
      setError(errorMessage(rollbackError, t.organizerRollbackError));
    } finally {
      setRollbackBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="settings-loading">
        <Loader2 size={18} />
        {t.loading}
      </div>
    );
  }

  const workflowBusy =
    importing ||
    inspecting ||
    reviewing ||
    autoExecuting ||
    repairLoading ||
    repairExecuting ||
    rollbackBusy;
  const mutationBusy = workflowBusy || planAction !== null;

  return (
    <section
      aria-busy={refreshing || mutationBusy}
      className="settings-panel wide"
    >
      <div className="settings-panel-heading">
        <div>
          <h2>{t.organizerPlans}</h2>
          <p>{t.organizerPlansDescription}</p>
        </div>
        <div className="toolbar-actions">
          <button
            disabled={mutationBusy}
            onClick={() => void openRepairPlan()}
            type="button"
          >
            {repairLoading ? <Loader2 size={14} /> : <ShieldCheck size={14} />}
            {t.repairOrganizerPipeline}
          </button>
          <button
            disabled={mutationBusy || (stats ? stats.autoExecutable === 0 : false)}
            onClick={() => void runAutoExecute()}
            type="button"
          >
            {autoExecuting ? <Loader2 size={14} /> : <CheckCheck size={14} />}
            {t.autoExecuteOrganizerPlans}
          </button>
          <button disabled={mutationBusy} onClick={() => void runAiReview()} type="button">
            {reviewing ? <Loader2 size={14} /> : <WandSparkles size={14} />}
            {t.aiReviewPlans}
          </button>
          <button disabled={mutationBusy} onClick={() => void runInspect()} type="button">
            {inspecting ? <Loader2 size={14} /> : <RefreshCw size={14} />}
            {t.inspectCompleted}
          </button>
        </div>
      </div>
      <div className="organizer-import-panel">
        <div>
          <strong>{t.importScan}</strong>
          <span>{t.importScanDescription}</span>
        </div>
        <input
          aria-label={t.importRoot}
          onChange={(event) => setImportDraft({ ...importDraft, root: event.target.value })}
          placeholder={t.importRoot}
          value={importDraft.root}
        />
        <select
          aria-label={t.mediaType}
          onChange={(event) => setImportDraft({ ...importDraft, mediaType: event.target.value })}
          value={importDraft.mediaType}
        >
          <option value="AUTO">{t.autoDetect}</option>
          <option value="ANIME">{t.anime}</option>
          <option value="MOVIE">{t.movies}</option>
          <option value="TV">{t.tv}</option>
        </select>
        <button
          disabled={mutationBusy || !importDraft.root.trim()}
          onClick={() => void runImportScan()}
          type="button"
        >
          {importing ? <Loader2 size={14} /> : <FolderSearch size={14} />}
          {t.importScan}
        </button>
      </div>
      <div className="organizer-filter-groups">
        <div className="filter-group">
          <span>{t.organizerViewFilters}</span>
          <div className="filter-tabs">
            {organizerViewFilters.map((status) => (
              <button
                className={filter === status ? "active" : ""}
                key={status}
                onClick={() => {
                  setPlanPage(1);
                  setFilter(status);
                }}
                type="button"
              >
                <span>{formatOrganizerFilter(status, t)}</span>
                <small>{countForOrganizerFilter(status, stats)}</small>
              </button>
            ))}
          </div>
        </div>
        <div className="filter-group">
          <span>{t.organizerStatusFilters}</span>
          <div className="filter-tabs">
            {organizerStatusFilters.map((status) => (
              <button
                className={filter === status ? "active" : ""}
                key={status}
                onClick={() => {
                  setPlanPage(1);
                  setFilter(status);
                }}
                type="button"
              >
                <span>{formatOrganizerFilter(status, t)}</span>
                <small>{countForOrganizerFilter(status, stats)}</small>
              </button>
            ))}
          </div>
        </div>
      </div>
      {error ? (
        <div className="settings-alert" role="alert">
          {error}
        </div>
      ) : null}
      {status ? (
        <div aria-live="polite" className="settings-success">
          {status}
        </div>
      ) : null}
      <div className="organizer-result-summary">
        <span>
          {filter === "ALL"
            ? `${t.allOrganizerPlans}: ${pageInfo.total}`
            : `${formatOrganizerFilter(filter, t)}: ${pageInfo.total} · ${t.allOrganizerPlans}: ${stats?.all ?? "-"}`}
        </span>
        {refreshing ? <Loader2 aria-label={t.loading} size={13} /> : null}
      </div>
      <div className="organizer-list">
        {plans.length === 0 ? (
          <p>{emptyOrganizerMessage(filter, t)}</p>
        ) : (
          plans.map((plan) => {
            const executable = canExecutePlan(plan);
            const rejectable = canRejectPlan(plan);
            const title = organizerPlanTitle(plan, t);
            const activeAction = planAction?.id === plan.id ? planAction.action : null;
            return (
              <article
                className={plan.id === linkedPlanId ? "linked" : undefined}
                id={`organizer-plan-${plan.id}`}
                key={plan.id}
              >
                <div className="organizer-plan-heading">
                  <div className="organizer-plan-media">
                    {plan.metadata?.posterUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="organizer-poster" src={plan.metadata.posterUrl} alt="" />
                    ) : (
                      <span className="organizer-poster-fallback">{getTitleInitial(title)}</span>
                    )}
                    <div className="organizer-plan-title">
                      <h2>{title}</h2>
                      {plan.metadata?.year ? <span>{plan.metadata.year}</span> : null}
                      <div className="organizer-plan-badges">
                        <span className={`organizer-badge ${statusBadgeClass(plan.status)}`}>
                          {formatOrganizerStatus(plan.status, t)}
                        </span>
                        <span className={`organizer-badge ${confidenceBadgeClass(plan.confidence)}`}>
                          {t.organizerConfidence}: {Math.round(plan.confidence * 100)}%
                        </span>
                        {(plan.automation?.autoExecutable ?? plan.autoExecutable) ? (
                          <span className="organizer-badge ready">
                            {t.organizerAutoReadyBadge}
                          </span>
                        ) : null}
                      </div>
                      <p>
                        {formatMediaType(plan.mediaType, t)} · {formatOrganizerReason(plan.reason, t)}
                      </p>
                      <p className="organizer-plan-hint">{organizerPlanHint(plan, t)}</p>
                      {plan.metadata?.aiReview ? (
                        <div
                          className={`organizer-ai-summary ${organizerAiRiskClass(plan.metadata.aiReview.riskLevel)}`}
                        >
                          <WandSparkles size={15} />
                          <div>
                            <strong>
                              {t.organizerAiClassification}: {formatOrganizerAiRisk(plan.metadata.aiReview.riskLevel, t)} ·{" "}
                              {Math.round(plan.metadata.aiReview.confidence * 100)}%
                            </strong>
                            <span>{plan.metadata.aiReview.summary || t.organizerAiNoSummary}</span>
                            <small>
                              {t.organizerAiAccepted}: {plan.metadata.aiReview.acceptedItems} ·{" "}
                              {t.organizerAiRejected}: {plan.metadata.aiReview.rejectedItems}
                            </small>
                            {plan.metadata.aiReview.fileClassifications.length > 0 ? (
                              <details className="organizer-ai-files">
                                <summary>
                                  {t.organizerAiFileClassifications} ({plan.metadata.aiReview.fileClassifications.length})
                                </summary>
                                {plan.metadata.aiReview.fileClassifications.map((classification) => (
                                  <div key={classification.sourcePath}>
                                    <strong>{formatOrganizerAiRole(classification.role, t)}</strong>
                                    <span>
                                      {classification.season !== null ? `S${String(classification.season).padStart(2, "0")}` : ""}
                                      {classification.episodeNumber !== null ? `E${String(Math.floor(classification.episodeNumber)).padStart(2, "0")}` : ""}
                                      {` · ${Math.round(classification.confidence * 100)}%`}
                                    </span>
                                    <code title={classification.sourcePath}>{classification.sourcePath}</code>
                                    {classification.evidence ? <small>{classification.evidence}</small> : null}
                                  </div>
                                ))}
                              </details>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="toolbar-actions">
                    {canRegeneratePlan(plan) ? (
                      <button
                        disabled={mutationBusy}
                        onClick={() => void regenerate(plan)}
                        type="button"
                      >
                        {activeAction === "regenerate" ? (
                          <Loader2 size={14} />
                        ) : (
                          <RefreshCw size={14} />
                        )}
                        {t.regenerateOrganizerPlan}
                      </button>
                    ) : null}
                    <button
                      disabled={!canAiReviewPlan(plan) || mutationBusy}
                      onClick={() => void reviewPlanWithAi(plan)}
                      title={
                        plan.items.length > 60
                          ? t.organizerAiClassifyTooLarge
                          : t.organizerAiClassifyHint
                      }
                      type="button"
                    >
                      {activeAction === "ai-review" ? (
                        <Loader2 size={14} />
                      ) : (
                        <WandSparkles size={14} />
                      )}
                      {plan.metadata?.aiReview ? t.organizerAiClassifyAgain : t.organizerAiClassify}
                    </button>
                    {plan.metadata?.aiReview?.fileClassifications.length ? (
                      <button
                        disabled={!canApplyAiClassification(plan) || mutationBusy}
                        onClick={() => void applyPlanAiClassification(plan)}
                        title={t.organizerAiApplyHint}
                        type="button"
                      >
                        {activeAction === "ai-apply" ? <Loader2 size={14} /> : <CheckCheck size={14} />}
                        {plan.metadata.aiReview.appliedAt ? t.organizerAiApplyAgain : t.organizerAiApply}
                      </button>
                    ) : null}
                    <button
                      disabled={!executable || mutationBusy}
                      onClick={() => requestExecution(plan)}
                      type="button"
                    >
                      {activeAction === "execute" ? <Loader2 size={14} /> : <Check size={14} />}
                      {t.execute}
                    </button>
                    <button
                      disabled={!rejectable || mutationBusy}
                      onClick={() => void reject(plan)}
                      type="button"
                    >
                      {activeAction === "reject" ? <Loader2 size={14} /> : <X size={14} />}
                      {t.reject}
                    </button>
                  </div>
                </div>
                <div className="organizer-path-overview">
                  <OrganizerFolderSummary items={plan.items} t={t} />
                  <details>
                    <summary>
                      {t.organizerPathDetails} ({plan.items.length})
                    </summary>
                    <div className="organizer-paths">
                      {plan.items.map((item) => (
                        <div key={item.id}>
                          <span>{item.sourcePath}</span>
                          <strong>{item.targetPath}</strong>
                          {item.conflict ? <em>{item.conflictReason || t.conflict}</em> : null}
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              </article>
            );
          })
        )}
      </div>
      {pageInfo.total > 0 ? (
        <div className="candidate-pagination">
          <span>
            {t.queuePage} {pageInfo.page} / {pageInfo.totalPages} · {t.queueShowing}{" "}
            {organizerPageRangeLabel(pageInfo)}
          </span>
          <div>
            <button
              disabled={!pageInfo.hasPrevious}
              onClick={() => setPlanPage((page) => Math.max(1, page - 1))}
              type="button"
            >
              {t.queuePrevious}
            </button>
            <button
              disabled={!pageInfo.hasNext}
              onClick={() => setPlanPage((page) => page + 1)}
              type="button"
            >
              {t.queueNext}
            </button>
          </div>
        </div>
      ) : null}
      {operations.length > 0 ? (
        <details className="download-operation-log organizer-operation-log">
          <summary>{t.organizerOperationLog}</summary>
          <div>
            {operations.map((operation) => {
              const rollbackable =
                ["EXECUTE_MOVE", "REPAIR_LEGACY_MISARCHIVE"].includes(operation.action) &&
                operation.status === "SUCCEEDED" &&
                (operation.rollbackData?.moves?.length ?? 0) > 0;
              return (
                <article key={operation.id}>
                  <span>{formatOrganizerOperationAction(operation.action, t)}</span>
                  <strong>{formatOperationStatus(operation.status, t)}</strong>
                  <small>
                    {new Date(operation.createdAt).toLocaleString(locale)}
                    {operation.errorMessage ? ` · ${operation.errorMessage}` : ""}
                  </small>
                  {rollbackable ? (
                    <button
                      disabled={mutationBusy}
                      onClick={() => {
                        setError("");
                        setRollbackAcknowledged(false);
                        setPendingRollback(operation);
                      }}
                      type="button"
                    >
                      <RotateCcw size={13} />
                      {t.organizerRollback}
                    </button>
                  ) : null}
                </article>
              );
            })}
          </div>
        </details>
      ) : null}
      {pendingRollback ? (
        <div
          className="strategy-dialog-backdrop"
          onMouseDown={() => {
            if (!rollbackBusy) {
              setPendingRollback(null);
              setRollbackAcknowledged(false);
            }
          }}
          role="presentation"
        >
          <section
            aria-labelledby="organizer-rollback-dialog-title"
            aria-modal="true"
            className="strategy-dialog organizer-confirm-dialog"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="strategy-dialog-heading">
              <div>
                <h2 id="organizer-rollback-dialog-title">{t.organizerRollbackTitle}</h2>
                <p>{t.organizerRollbackDescription}</p>
              </div>
              <button
                aria-label={t.organizerExecutionCancel}
                className="strategy-dialog-close"
                disabled={rollbackBusy}
                onClick={() => {
                  setPendingRollback(null);
                  setRollbackAcknowledged(false);
                }}
                type="button"
              >
                <X size={16} />
              </button>
            </div>
            <div className="organizer-confirm-warning">
              <AlertTriangle size={18} />
              <div>
                <strong>{t.organizerRollbackWarningTitle}</strong>
                <span>{t.organizerRollbackWarning}</span>
              </div>
            </div>
            <div className="organizer-confirm-paths">
              {(pendingRollback.rollbackData?.moves ?? []).map((move) => (
                <div key={`${move.sourcePath}:${move.targetPath}`}>
                  <span>{t.organizerExecutionSource}</span>
                  <code>{move.sourcePath}</code>
                  <span>{t.organizerExecutionTarget}</span>
                  <strong>{move.targetPath}</strong>
                </div>
              ))}
            </div>
            <label className="organizer-confirm-check">
              <input
                autoFocus
                checked={rollbackAcknowledged}
                disabled={rollbackBusy}
                onChange={(event) => setRollbackAcknowledged(event.target.checked)}
                type="checkbox"
              />
              <span>{t.organizerRollbackAcknowledge}</span>
            </label>
            {error ? (
              <div className="settings-alert organizer-dialog-alert" role="alert">
                {error}
              </div>
            ) : null}
            <div className="strategy-dialog-actions">
              <button
                disabled={rollbackBusy}
                onClick={() => {
                  setPendingRollback(null);
                  setRollbackAcknowledged(false);
                }}
                type="button"
              >
                {t.organizerExecutionCancel}
              </button>
              <button
                className="danger-button"
                disabled={!rollbackAcknowledged || rollbackBusy}
                onClick={() => void rollbackOrganizerOperation(pendingRollback)}
                type="button"
              >
                {rollbackBusy ? <Loader2 size={14} /> : <RotateCcw size={14} />}
                {t.organizerRollbackConfirm}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {pendingExecution ? (
        <div
          className="strategy-dialog-backdrop"
          onMouseDown={() => {
            if (!planAction) {
              setPendingExecution(null);
              setExecutionAcknowledged(false);
            }
          }}
          role="presentation"
        >
          <section
            aria-labelledby="organizer-execution-dialog-title"
            aria-modal="true"
            className="strategy-dialog organizer-confirm-dialog"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="strategy-dialog-heading">
              <div>
                <h2 id="organizer-execution-dialog-title">{t.organizerExecutionTitle}</h2>
                <p>{t.organizerExecutionDescription}</p>
              </div>
              <button
                aria-label={t.organizerExecutionCancel}
                className="strategy-dialog-close"
                disabled={Boolean(planAction)}
                onClick={() => {
                  setPendingExecution(null);
                  setExecutionAcknowledged(false);
                }}
                type="button"
              >
                <X size={16} />
              </button>
            </div>
            <div className="organizer-confirm-warning">
              <AlertTriangle size={18} />
              <div>
                <strong>{t.organizerExecutionWarningTitle}</strong>
                <span>{t.organizerExecutionWarning}</span>
              </div>
            </div>
            <div className="strategy-summary-grid organizer-confirm-summary">
              <div>
                <span>{t.organizerExecutionMedia}</span>
                <strong>{organizerPlanTitle(pendingExecution, t)}</strong>
              </div>
              <div>
                <span>{t.organizerConfidence}</span>
                <strong>{Math.round(pendingExecution.confidence * 100)}%</strong>
              </div>
              <div>
                <span>{t.organizerExecutionFiles}</span>
                <strong>{pendingExecution.items.length}</strong>
              </div>
              <div>
                <span>{t.organizerStatusFilters}</span>
                <strong>{formatOrganizerStatus(pendingExecution.status, t)}</strong>
              </div>
            </div>
            {pendingExecution.metadata?.aiReview ? (
              <div
                className={`organizer-ai-summary organizer-confirm-ai ${organizerAiRiskClass(pendingExecution.metadata.aiReview.riskLevel)}`}
              >
                <WandSparkles size={16} />
                <div>
                  <strong>
                    {t.organizerAiClassification}: {formatOrganizerAiRisk(pendingExecution.metadata.aiReview.riskLevel, t)} ·{" "}
                    {Math.round(pendingExecution.metadata.aiReview.confidence * 100)}%
                  </strong>
                  <span>{pendingExecution.metadata.aiReview.summary || t.organizerAiNoSummary}</span>
                  <small>
                    {t.organizerAiAccepted}: {pendingExecution.metadata.aiReview.acceptedItems} ·{" "}
                    {t.organizerAiRejected}: {pendingExecution.metadata.aiReview.rejectedItems}
                  </small>
                </div>
              </div>
            ) : (
              <div className="organizer-ai-callout">
                <WandSparkles size={16} />
                <div>
                  <strong>{t.organizerAiNotReviewed}</strong>
                  <span>{t.organizerAiNotReviewedHint}</span>
                </div>
              </div>
            )}
            <div className="organizer-confirm-folder-summary">
              <OrganizerFolderSummary items={pendingExecution.items} t={t} />
            </div>
            <details className="organizer-confirm-path-details">
              <summary>
                {t.organizerPathDetails} ({pendingExecution.items.length})
              </summary>
              <div className="organizer-confirm-paths">
                {pendingExecution.items.map((item) => (
                  <div key={item.id}>
                    <span>{t.organizerExecutionSource}</span>
                    <code>{item.sourcePath}</code>
                    <span>{t.organizerExecutionTarget}</span>
                    <strong>{item.targetPath}</strong>
                  </div>
                ))}
              </div>
            </details>
            <label className="organizer-confirm-check">
              <input
                autoFocus
                checked={executionAcknowledged}
                disabled={Boolean(planAction)}
                onChange={(event) => setExecutionAcknowledged(event.target.checked)}
                type="checkbox"
              />
              <span>
                {organizerAiReviewIsTrusted(pendingExecution)
                  ? t.organizerExecutionAcknowledgeAi
                  : t.organizerExecutionAcknowledge}
              </span>
            </label>
            {error ? (
              <div className="settings-alert organizer-dialog-alert" role="alert">
                {error}
              </div>
            ) : null}
            <div className="strategy-dialog-actions">
              <button
                disabled={Boolean(planAction)}
                onClick={() => {
                  setPendingExecution(null);
                  setExecutionAcknowledged(false);
                }}
                type="button"
              >
                {t.organizerExecutionCancel}
              </button>
              <button
                className="danger-button"
                disabled={!executionAcknowledged || Boolean(planAction)}
                onClick={() => void execute(pendingExecution)}
                type="button"
              >
                {planAction?.action === "execute" ? <Loader2 size={14} /> : <Check size={14} />}
                {t.organizerExecutionConfirmFast} ({pendingExecution.items.length})
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {repairPlan ? (
        <div
          className="strategy-dialog-backdrop"
          onMouseDown={() => {
            if (!repairExecuting) {
              setRepairPlan(null);
              setRepairSelection([]);
            }
          }}
          role="presentation"
        >
          <section
            aria-labelledby="organizer-repair-dialog-title"
            aria-modal="true"
            className="strategy-dialog organizer-repair-dialog"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="strategy-dialog-heading">
              <div>
                <h2 id="organizer-repair-dialog-title">{t.organizerRepairPreviewTitle}</h2>
                <p>{t.organizerRepairPreviewDescription}</p>
              </div>
              <button
                aria-label={t.organizerExecutionCancel}
                className="strategy-dialog-close"
                disabled={repairExecuting}
                onClick={() => {
                  setRepairPlan(null);
                  setRepairSelection([]);
                }}
                type="button"
              >
                <X size={16} />
              </button>
            </div>
            <div className="strategy-summary-grid organizer-repair-summary">
              <div>
                <span>{t.organizerRepairPlans}</span>
                <strong>{repairPlan.summary.plans}</strong>
              </div>
              <div>
                <span>{t.organizerRepairActions}</span>
                <strong>{repairPlan.summary.actions}</strong>
              </div>
              <div>
                <span>{t.organizerRepairExecutable}</span>
                <strong>{repairPlan.summary.executable}</strong>
              </div>
              <div>
                <span>{t.organizerRepairReview}</span>
                <strong>{repairPlan.summary.review}</strong>
              </div>
            </div>
            <div className="organizer-repair-list">
              {repairPlan.items.length === 0 ? (
                <p>{t.organizerRepairEmpty}</p>
              ) : (
                repairPlan.items.map((item) => (
                  <label className={!item.executable ? "disabled" : ""} key={item.actionId}>
                    <input
                      checked={repairSelection.includes(item.actionId)}
                      disabled={!item.executable || repairExecuting}
                      onChange={(event) =>
                        setRepairSelection((current) =>
                          event.target.checked
                            ? [...current, item.actionId]
                            : current.filter((actionId) => actionId !== item.actionId),
                        )
                      }
                      type="checkbox"
                    />
                    <div>
                      <strong>
                        {item.title || t.unknownTitle}
                        {item.episode ? ` · E${item.episode}` : ""}
                      </strong>
                      <span>{formatOrganizerRepairKind(item.kind, t)}</span>
                      <p>{organizerRepairKindDescription(item.kind, t)}</p>
                    </div>
                    <em>
                      {item.executable
                        ? formatOrganizerRepairConfidence(item.confidence, t)
                        : t.organizerRepairReviewOnly}
                    </em>
                  </label>
                ))
              )}
            </div>
            {error ? (
              <div className="settings-alert organizer-dialog-alert" role="alert">
                {error}
              </div>
            ) : null}
            <div className="strategy-dialog-actions">
              <button
                disabled={repairExecuting}
                onClick={() => {
                  setRepairPlan(null);
                  setRepairSelection([]);
                }}
                type="button"
              >
                {t.organizerExecutionCancel}
              </button>
              <button
                className="strategy-confirm-button"
                disabled={repairExecuting || repairSelection.length === 0}
                onClick={() => void executeRepairPlan()}
                type="button"
              >
                {repairExecuting ? <Loader2 size={14} /> : <ShieldCheck size={14} />}
                {t.organizerRepairApply} ({repairSelection.length})
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function getTitleInitial(title: string) {
  return title.trim().slice(0, 1).toUpperCase() || "?";
}

function organizerPlanTitle(
  plan: OrganizerPlan,
  t: ReturnType<typeof getMessages>,
) {
  return (
    plan.metadata?.title ||
    plan.candidate?.group?.displayTitle ||
    plan.candidate?.parsedTitle ||
    t.unknownTitle
  );
}

function OrganizerFolderSummary({
  items,
  t,
}: {
  items: OrganizerPlan["items"];
  t: ReturnType<typeof getMessages>;
}) {
  const summary = summarizeOrganizerFolders(items);
  return (
    <div className="organizer-folder-summary">
      <div>
        <span>{t.organizerExecutionSource}</span>
        <code title={summary.source}>{summary.source}</code>
      </div>
      <div>
        <span>{t.organizerExecutionTarget}</span>
        <strong title={summary.target}>{summary.target}</strong>
      </div>
    </div>
  );
}

function summarizeOrganizerFolders(items: OrganizerPlan["items"]) {
  return {
    source: commonOrganizerDirectory(items.map((item) => item.sourcePath)),
    target: commonOrganizerDirectory(items.map((item) => item.targetPath)),
  };
}

function commonOrganizerDirectory(paths: string[]) {
  if (paths.length === 0) {
    return "-";
  }
  const directories = paths.map((filePath) => {
    const lastSeparator = filePath.lastIndexOf("/");
    return lastSeparator > 0 ? filePath.slice(0, lastSeparator) : filePath;
  });
  const segments = directories.map((directory) => directory.split("/").filter(Boolean));
  const common = [...segments[0]];
  for (const parts of segments.slice(1)) {
    let index = 0;
    while (index < common.length && common[index] === parts[index]) {
      index += 1;
    }
    common.length = index;
  }
  return common.length > 0 ? `/${common.join("/")}` : directories[0];
}

function canAiReviewPlan(plan: OrganizerPlan) {
  return (
    Boolean(plan.candidate) &&
    plan.items.length > 0 &&
    plan.items.length <= 60 &&
    !["AUTO_ARCHIVED", "EXECUTED", "EXECUTING", "REJECTED"].includes(plan.status)
  );
}

function organizerAiReviewIsTrusted(plan: OrganizerPlan) {
  const review = plan.metadata?.aiReview;
  return Boolean(
    review &&
      review.riskLevel === "OK" &&
      review.confidence >= 0.8 &&
      review.rejectedItems === 0 &&
      review.acceptedItems === plan.items.length,
  );
}

function canApplyAiClassification(plan: OrganizerPlan) {
  const review = plan.metadata?.aiReview;
  return Boolean(
    review &&
      !review.appliedAt &&
      review.fileClassifications.length === plan.items.length &&
      review.confidence >= 0.8 &&
      review.fileClassifications.every((classification) => classification.confidence >= 0.8) &&
      !["AUTO_ARCHIVED", "EXECUTED", "EXECUTING", "REJECTED"].includes(plan.status),
  );
}

function formatOrganizerAiRole(
  role: OrganizerAiFileRole,
  t: ReturnType<typeof getMessages>,
) {
  return {
    MAIN_VIDEO: t.organizerAiRoleMainVideo,
    EXTRA_VIDEO: t.organizerAiRoleExtraVideo,
    AUDIO: t.organizerAiRoleAudio,
    IMAGE: t.organizerAiRoleImage,
    METADATA: t.organizerAiRoleMetadata,
    UNRELATED: t.organizerAiRoleUnrelated,
  }[role];
}

function organizerAiRiskClass(riskLevel: "OK" | "REVIEW" | "REJECT") {
  if (riskLevel === "OK") {
    return "safe";
  }
  if (riskLevel === "REJECT") {
    return "danger";
  }
  return "review";
}

function formatOrganizerAiRisk(
  riskLevel: "OK" | "REVIEW" | "REJECT",
  t: ReturnType<typeof getMessages>,
) {
  if (riskLevel === "OK") {
    return t.organizerAiRiskOk;
  }
  if (riskLevel === "REJECT") {
    return t.organizerAiRiskReject;
  }
  return t.organizerAiRiskReview;
}

function canExecutePlan(plan: OrganizerPlan) {
  if (plan.automation) {
    return plan.automation.executable;
  }
  return (
    ["PENDING", "NEEDS_REVIEW"].includes(plan.status) &&
    plan.items.length > 0 &&
    plan.items.every((item) => !item.conflict)
  );
}

function canRejectPlan(plan: OrganizerPlan) {
  return !["AUTO_ARCHIVED", "EXECUTED", "EXECUTING", "REJECTED"].includes(plan.status);
}

function canRegeneratePlan(plan: OrganizerPlan) {
  return plan.status === "REJECTED";
}

function organizerPlanParams(filter: OrganizerFilter, page: number, planId?: string | null) {
  const params = new URLSearchParams();
  if (filter === "ACTIVE") {
    params.set("view", "active");
  } else if (filter === "AUTO_READY") {
    params.set("view", "auto");
  } else if (filter === "HISTORY") {
    params.set("view", "history");
  } else if (filter === "ALL") {
    params.set("view", "all");
  } else {
    params.set("status", filter);
  }
  params.set("page", String(page));
  params.set("pageSize", "50");
  if (planId) {
    params.set("planId", planId);
  }
  return params.toString();
}

function organizerPageRangeLabel(page: OrganizerPage) {
  if (page.total === 0) {
    return "0 / 0";
  }
  const start = (page.page - 1) * page.pageSize + 1;
  const end = Math.min(page.page * page.pageSize, page.total);
  return `${start}-${end} / ${page.total}`;
}

function formatOrganizerFilter(filter: OrganizerFilter, t: ReturnType<typeof getMessages>) {
  if (filter === "ACTIVE") {
    return t.activeOrganizerPlans;
  }
  if (filter === "AUTO_READY") {
    return t.autoExecutableOrganizerPlans;
  }
  if (filter === "HISTORY") {
    return t.organizerHistory;
  }
  if (filter === "ALL") {
    return t.allOrganizerPlans;
  }
  if (filter === "PENDING") {
    return t.organizerStatusPending;
  }
  if (filter === "NEEDS_REVIEW") {
    return t.organizerStatusNeedsReview;
  }
  if (filter === "EXECUTING") {
    return t.organizerStatusExecuting;
  }
  if (filter === "CONFLICT") {
    return t.organizerStatusConflict;
  }
  if (filter === "FAILED") {
    return t.organizerStatusFailed;
  }
  if (filter === "EXECUTED") {
    return t.organizerStatusExecuted;
  }
  if (filter === "REJECTED") {
    return t.organizerStatusRejected;
  }
  return t.organizerStatusAutoArchived;
}

function formatOrganizerStatus(status: string, t: ReturnType<typeof getMessages>) {
  if (status === "PENDING") {
    return t.organizerStatusPending;
  }
  if (status === "NEEDS_REVIEW") {
    return t.organizerStatusNeedsReview;
  }
  if (status === "EXECUTING") {
    return t.organizerStatusExecuting;
  }
  if (status === "CONFLICT") {
    return t.organizerStatusConflict;
  }
  if (status === "FAILED") {
    return t.organizerStatusFailed;
  }
  if (status === "EXECUTED") {
    return t.organizerStatusExecuted;
  }
  if (status === "REJECTED") {
    return t.organizerStatusRejected;
  }
  if (status === "AUTO_ARCHIVED") {
    return t.organizerStatusAutoArchived;
  }
  return status;
}

function statusBadgeClass(status: string) {
  if (
    status === "PENDING" ||
    status === "AUTO_ARCHIVED" ||
    status === "EXECUTED" ||
    status === "EXECUTING"
  ) {
    return "ready";
  }
  if (status === "CONFLICT" || status === "FAILED") {
    return "danger";
  }
  if (status === "REJECTED") {
    return "muted";
  }
  return "review";
}

function confidenceBadgeClass(confidence: number) {
  if (confidence >= 0.9) {
    return "ready";
  }
  if (confidence >= 0.82) {
    return "review";
  }
  return "danger";
}

function organizerPlanHint(plan: OrganizerPlan, t: ReturnType<typeof getMessages>) {
  if (plan.automation && !plan.automation.autoExecutable && plan.automation.reasons.length > 0) {
    return plan.automation.reasons
      .map((reason) => formatOrganizerAutomationReason(reason, t))
      .join(" ");
  }
  if (plan.items.length === 0) {
    return t.organizerNoFilesHint;
  }
  if (plan.items.some((item) => item.conflict)) {
    return t.organizerConflictHint;
  }
  if (plan.status === "PENDING") {
    return plan.autoExecutable ? t.organizerAutoReadyHint : t.organizerReadyToExecuteHint;
  }
  if (plan.status === "NEEDS_REVIEW") {
    return t.organizerNeedsReviewHint;
  }
  if (plan.status === "EXECUTING") {
    return t.organizerExecutingHint;
  }
  if (plan.status === "FAILED") {
    return t.organizerFailedHint;
  }
  if (plan.status === "EXECUTED" || plan.status === "AUTO_ARCHIVED") {
    return t.organizerCompletedHint;
  }
  if (plan.status === "REJECTED") {
    return t.organizerRejectedHint;
  }
  return t.organizerReadyToExecuteHint;
}

function formatOrganizerReason(
  reason: string | null | undefined,
  t: ReturnType<typeof getMessages>,
) {
  if (!reason) {
    return "-";
  }
  if (reason === "Ready for confirmation") {
    return t.organizerReasonReady;
  }
  if (reason === "Needs manual confirmation") {
    return t.organizerReasonNeedsReview;
  }
  if (reason === "Metadata needs manual confirmation") {
    return t.organizerReasonMetadataReview;
  }
  if (reason === "Rejected by user") {
    return t.organizerReasonRejected;
  }
  if (reason === "Organizer plan has unresolved episode identity.") {
    return t.organizerReasonUnresolvedEpisode;
  }
  return reason;
}

function formatOrganizerAutomationReason(
  reason: string,
  t: ReturnType<typeof getMessages>,
) {
  const messages: Record<string, string> = {
    "Plan is already closed.": t.organizerAutomationClosed,
    "Plan is marked as failed.": t.organizerAutomationFailed,
    "Plan execution is already in progress.": t.organizerAutomationExecuting,
    "Plan is not in an executable status.": t.organizerAutomationNotExecutable,
    "Plan has no files.": t.organizerAutomationNoFiles,
    "Plan has target path conflicts.": t.organizerAutomationConflict,
    "One or more source files are missing.": t.organizerAutomationSourceMissing,
    "Plan has a polluted target path.": t.organizerAutomationPollutedTarget,
    "Plan has unresolved episode identity.": t.organizerAutomationUnresolvedEpisode,
    "Plan puts an episode video under Extras.": t.organizerAutomationEpisodeInExtras,
    "A target filename does not preserve the source extension.":
      t.organizerAutomationExtensionMismatch,
    "Automatic archive requires pending status.": t.organizerAutomationPendingRequired,
    "Confidence is below the automatic archive threshold.":
      t.organizerAutomationLowConfidence,
    "Plan was not marked trusted when it was created.": t.organizerAutomationNotTrusted,
    "Plan has no grouped candidate.": t.organizerAutomationNoCandidate,
    "One or more source files do not match the candidate title.":
      t.organizerAutomationTitleMismatch,
  };
  return messages[reason] ?? reason;
}

function formatOrganizerOperationAction(
  action: string,
  t: ReturnType<typeof getMessages>,
) {
  return {
    EXECUTE_MOVE: t.organizerOperationExecute,
    ROLLBACK_EXECUTE_MOVE: t.organizerOperationRollback,
    REPAIR_LEGACY_MISARCHIVE: t.organizerOperationRepairLegacyMisarchive,
    ROLLBACK_REPAIR_LEGACY_MISARCHIVE: t.organizerOperationRollbackLegacyMisarchive,
  }[action] ?? action;
}

function formatOperationStatus(status: string, t: ReturnType<typeof getMessages>) {
  return {
    STARTED: t.downloadOperationStarted,
    SUCCEEDED: t.downloadOperationSucceeded,
    FAILED: t.downloadOperationFailed,
    ROLLBACK_STARTED: t.organizerOperationRollbackStarted,
    ROLLBACK_FAILED: t.organizerOperationRollbackFailed,
    ROLLED_BACK: t.downloadOperationRolledBack,
  }[status] ?? status;
}

function emptyOrganizerMessage(filter: OrganizerFilter, t: ReturnType<typeof getMessages>) {
  if (filter === "ALL") {
    return t.noOrganizerPlans;
  }
  if (filter === "AUTO_READY") {
    return t.noAutoExecutableOrganizerPlans;
  }
  if (filter === "ACTIVE") {
    return t.noActiveOrganizerPlans;
  }
  return t.noOrganizerPlansForFilter;
}

function countForOrganizerFilter(filter: OrganizerFilter, stats: OrganizerStats | null) {
  if (!stats) {
    return "-";
  }
  if (filter === "ACTIVE") {
    return String(stats.active);
  }
  if (filter === "AUTO_READY") {
    return String(stats.autoExecutable);
  }
  if (filter === "HISTORY") {
    return String(
      (stats.byStatus.EXECUTED ?? 0) +
        (stats.byStatus.AUTO_ARCHIVED ?? 0) +
        (stats.byStatus.REJECTED ?? 0),
    );
  }
  if (filter === "ALL") {
    return String(stats.all);
  }
  return String(stats.byStatus[filter] ?? 0);
}

function formatMediaType(
  value: OrganizerPlan["mediaType"],
  t: ReturnType<typeof getMessages>,
) {
  if (value === "ANIME") {
    return t.anime;
  }
  if (value === "MOVIE") {
    return t.movies;
  }
  return t.tv;
}

function formatOrganizerRepairKind(
  kind: OrganizerRepairPlan["items"][number]["kind"],
  t: ReturnType<typeof getMessages>,
) {
  if (kind === "delete_stale") {
    return t.organizerRepairDeleteStale;
  }
  if (kind === "resolve_archived") {
    return t.organizerRepairResolveArchived;
  }
  if (kind === "reclassify_episode") {
    return t.organizerRepairReclassifyEpisode;
  }
  if (kind === "regenerate") {
    return t.organizerRepairRegenerate;
  }
  if (kind === "retry_missing") {
    return t.organizerRepairRetryMissing;
  }
  if (kind === "wait_download") {
    return t.organizerRepairWaitDownload;
  }
  return t.organizerRepairManualReview;
}

function organizerRepairKindDescription(
  kind: OrganizerRepairPlan["items"][number]["kind"],
  t: ReturnType<typeof getMessages>,
) {
  if (kind === "delete_stale") {
    return t.organizerRepairDeleteStaleDescription;
  }
  if (kind === "resolve_archived") {
    return t.organizerRepairResolveArchivedDescription;
  }
  if (kind === "reclassify_episode") {
    return t.organizerRepairReclassifyEpisodeDescription;
  }
  if (kind === "regenerate") {
    return t.organizerRepairRegenerateDescription;
  }
  if (kind === "retry_missing") {
    return t.organizerRepairRetryMissingDescription;
  }
  if (kind === "wait_download") {
    return t.organizerRepairWaitDownloadDescription;
  }
  return t.organizerRepairManualReviewDescription;
}

function formatOrganizerRepairConfidence(
  confidence: OrganizerRepairPlan["items"][number]["confidence"],
  t: ReturnType<typeof getMessages>,
) {
  if (confidence === "high") {
    return t.organizerRepairConfidenceHigh;
  }
  if (confidence === "medium") {
    return t.organizerRepairConfidenceMedium;
  }
  return t.organizerRepairConfidenceLow;
}

async function requestJson<T>(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  fallbackMessage: string,
  errorMessages?: Record<string, string>,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch {
    throw new Error(fallbackMessage);
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: unknown; message?: unknown }
      | null;
    const mappedMessage =
      typeof body?.error === "string" ? errorMessages?.[body.error] : undefined;
    throw new Error(
      mappedMessage ??
        (typeof body?.message === "string" && body.message.trim()
          ? body.message
          : fallbackMessage),
    );
  }
  return response.json() as Promise<T>;
}

function errorMessage(error: unknown, fallbackMessage: string) {
  return error instanceof Error ? error.message : fallbackMessage;
}
