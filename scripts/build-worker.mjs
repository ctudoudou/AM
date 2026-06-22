import { build } from "esbuild";

await build({
  entryPoints: ["src/worker.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  outfile: "dist/worker.cjs",
  tsconfig: "tsconfig.json",
  packages: "bundle",
  external: ["@prisma/client"],
  logLevel: "info",
});
