import type { MediaType } from "@prisma/client";

export type CandidateWindowCategory = "ALL" | "BATCH";
export type CandidateWindowSort = "LATEST" | "UNSUBSCRIBED" | "VERSIONS" | "REVIEW";

export function shouldUseLatestCandidateWindow(input: {
  category: CandidateWindowCategory;
  filterCanonicalCoverage: boolean;
  mediaType: MediaType | null;
  query: string;
  sort: CandidateWindowSort;
  status: string;
}) {
  return (
    input.filterCanonicalCoverage &&
    input.sort === "LATEST" &&
    input.status === "ALL" &&
    input.mediaType === null &&
    input.query.length === 0
  );
}

export function latestCandidateWindowSize(skip: number, take: number) {
  return Math.min(Math.max(skip + take * 3 + 30, 60), 300);
}
