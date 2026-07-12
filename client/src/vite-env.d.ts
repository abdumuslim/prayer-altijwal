/// <reference types="vite/client" />

// App version injected at build time from package.json (vite.config.ts `define`).
// Semver source of truth — docs/V2_REDESIGN_SPEC.md Phase 0 / DECISIONS.md ADR-008.
declare const __APP_VERSION__: string;
