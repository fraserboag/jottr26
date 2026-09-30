import type { NextConfig } from "next";
import { randomUUID } from "node:crypto";
import { writeOfflineManifest } from "./scripts/offline-manifest.mjs";

// Embedded in the compiled HTML, so a shell always asks for its own build's
// dependency list, even when another deployment has gone live in the meantime.
// Next evaluates this config in its compiler workers too. Share the id through
// their inherited environment so compilation and the build hook use one URL.
const offlineBuildId = process.env.JOTTR_OFFLINE_BUILD_ID ??= randomUUID();
const offlineManifest = `/_next/static/jottr-offline/${offlineBuildId}.json`;

const nextConfig: NextConfig = {
  compiler: {
    runAfterProductionCompile: async ({ distDir }) => {
      await writeOfflineManifest(distDir, offlineManifest);
    },
  },
  env: {
    // When this build was made, shown in the settings so a new deploy can be
    // told apart from the last.
    BUILD_TIME: new Date().toISOString(),
    JOTTR_OFFLINE_MANIFEST: offlineManifest,
  },
};

export default nextConfig;
