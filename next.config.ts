import type { NextConfig } from "next";

const configuredBuildCpus = Number.parseInt(process.env.NEXT_BUILD_CPUS ?? "", 10);
const buildCpus = Number.isFinite(configuredBuildCpus) && configuredBuildCpus > 0 ? configuredBuildCpus : 4;

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    cpus: buildCpus,
    staticGenerationMinPagesPerWorker: 100,
    turbopackFileSystemCacheForBuild: true,
  },
};

export default nextConfig;
