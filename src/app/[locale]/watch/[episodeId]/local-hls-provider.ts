import {
  isHLSProvider,
  type HLSConstructorLoader,
  type MediaProviderAdapter,
} from "@vidstack/react";

export const loadLocalHls: HLSConstructorLoader = () => import("hls.js");

export function configureLocalHlsProvider(provider: MediaProviderAdapter | null) {
  if (!isHLSProvider(provider)) {
    return false;
  }

  provider.library = loadLocalHls;
  return true;
}
