const STALE_BUNDLE_PATTERNS = [
  /Failed to load chunk/i,
  /ChunkLoadError/,
  /Loading chunk \S+ failed/i,
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
]

export function isStaleBundleError(error: string): boolean {
  return STALE_BUNDLE_PATTERNS.some((pattern) => pattern.test(error))
}
