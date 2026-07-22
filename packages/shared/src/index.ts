// Generated OpenAPI TS client + a thin typed fetch wrapper (see CLAUDE.md:
// "don't hand-write" types — regenerate src/generated.ts via `pnpm generate`
// whenever apps/api's schema changes).
export { api, apiOrigin, ensureCsrfCookie } from "./client";
export type { components, operations, paths } from "./generated";
export { parseBibtex, serializeEntry, looksLikeBibtex, findDuplicateByContent } from "./bibtex";
export type { BibEntry } from "./bibtex";
export { extractCitedKeys, findUnusedBibEntries } from "./citeUsage";
