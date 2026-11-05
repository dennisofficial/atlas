export const PREVIEW_HOST_PATTERN = /^\d{2,5}-[a-z0-9]{10}\.byatlas\.dev$/

export const ATLAS_WEB_ORIGIN_PATTERNS: readonly RegExp[] = [
  /^https:\/\/byatlas\.io$/,
  /^https:\/\/\d{2,5}-[a-z0-9]{10}\.byatlas\.dev$/,
  /^http:\/\/localhost:\d{1,5}$/,
]

export function isPreviewHost(hostname: string): boolean {
  return PREVIEW_HOST_PATTERN.test(hostname)
}

export function isAtlasWebOrigin(origin: string): boolean {
  return ATLAS_WEB_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin))
}
