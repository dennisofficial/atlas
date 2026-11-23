export const DEFAULT_PREVIEW_DOMAIN = 'byatlas.dev'

const LABEL = '\\d{2,5}-[a-z0-9]{10}'

const hostPatterns = new Map<string, RegExp>()

const escaped = (domain: string): string => domain.replaceAll('.', '\\.')

export function previewHostPatternOf(domain: string): RegExp {
  const held = hostPatterns.get(domain)
  if (held !== undefined) return held
  const pattern = new RegExp(`^${LABEL}\\.${escaped(domain)}$`)
  hostPatterns.set(domain, pattern)
  return pattern
}

export const PREVIEW_HOST_PATTERN = previewHostPatternOf(DEFAULT_PREVIEW_DOMAIN)

export function atlasWebOriginPatternsOf(domain: string): readonly RegExp[] {
  return [
    /^https:\/\/byatlas\.io$/,
    new RegExp(`^https:\\/\\/${LABEL}\\.${escaped(domain)}$`),
    /^http:\/\/localhost:\d{1,5}$/,
  ]
}

export const ATLAS_WEB_ORIGIN_PATTERNS = atlasWebOriginPatternsOf(DEFAULT_PREVIEW_DOMAIN)

export function isPreviewHost(hostname: string, domain: string = DEFAULT_PREVIEW_DOMAIN): boolean {
  return previewHostPatternOf(domain).test(hostname)
}

export function isAtlasWebOrigin(origin: string, domain: string = DEFAULT_PREVIEW_DOMAIN): boolean {
  return atlasWebOriginPatternsOf(domain).some((pattern) => pattern.test(origin))
}
