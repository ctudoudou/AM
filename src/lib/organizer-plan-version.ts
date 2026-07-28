import { createHash } from "node:crypto";

export type OrganizerPlanVersionInput = {
  id: string;
  status: string;
  confidence: number;
  autoExecutable: boolean;
  reason: string | null;
  updatedAt: Date;
  items: Array<{
    id: string;
    sourcePath: string;
    targetPath: string;
    fileType: string;
    conflict: boolean;
    conflictReason: string | null;
  }>;
};

export function createOrganizerPlanVersion(plan: OrganizerPlanVersionInput) {
  const snapshot = {
    id: plan.id,
    status: plan.status,
    confidence: plan.confidence,
    autoExecutable: plan.autoExecutable,
    reason: plan.reason,
    updatedAt: plan.updatedAt.toISOString(),
    items: [...plan.items]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((item) => ({
        id: item.id,
        sourcePath: item.sourcePath,
        targetPath: item.targetPath,
        fileType: item.fileType,
        conflict: item.conflict,
        conflictReason: item.conflictReason,
      })),
  };
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}
