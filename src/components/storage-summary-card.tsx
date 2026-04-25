"use client";

import { useEffect, useState } from "react";
import { HardDrive } from "lucide-react";

type StorageSummary = {
  totalBytes: string;
  freeBytes: string;
  usedBytes: string;
  usedPercent: number;
};

export function StorageSummaryCard({
  availableLabel,
  storageLabel,
  usedLabel,
}: {
  availableLabel: string;
  storageLabel: string;
  usedLabel: string;
}) {
  const [storage, setStorage] = useState<StorageSummary | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      fetch("/api/system/storage")
        .then((response) => (response.ok ? response.json() : null))
        .then((body: StorageSummary | null) => setStorage(body))
        .catch(() => setStorage(null));
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  const usedPercent = storage?.usedPercent ?? 0;

  return (
    <div className="storage-card">
      <div>
        <span>
          <HardDrive size={14} />
          {storageLabel}
        </span>
        <b>
          {storage ? `${formatBytes(storage.usedBytes)} / ${formatBytes(storage.totalBytes)}` : "--"}
        </b>
      </div>
      <div className="meter">
        <span style={{ width: `${usedPercent}%` }} />
      </div>
      <div>
        <small>
          {storage ? `${usedPercent}%` : "--"} {usedLabel}
        </small>
        <small>
          {storage ? formatBytes(storage.freeBytes) : "--"} {availableLabel}
        </small>
      </div>
    </div>
  );
}

function formatBytes(value: string) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}
