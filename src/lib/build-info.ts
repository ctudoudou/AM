export class BuildRevisionMismatchError extends Error {}

export function getKuraBuildRevision() {
  return process.env.KURA_BUILD_SHA?.trim() || "development";
}

export function assertKuraBuildRevision(clientRevision: string) {
  const serverRevision = getKuraBuildRevision();
  if (clientRevision !== serverRevision) {
    throw new BuildRevisionMismatchError(
      "Kura was updated after this page loaded. Reload the page before changing files.",
    );
  }
  return serverRevision;
}
