export const TOKEN_LENGTH = 8

export const ARTIFACT_HOST_MAX_LENGTH = 64

export const PREVIEW_HOST_PATTERN = /^\d{2,5}-[a-z0-9]{10}\.byatlas\.dev$/

const PREVIEW_LABEL_PATTERN = /^\d{2,5}-[a-z0-9]{10}$/

const TOKEN_PATTERN = /^[a-z0-9]{8}$/

const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/

export class ArtifactTokenError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ArtifactTokenError'
  }
}

export class ArtifactSlugError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ArtifactSlugError'
  }
}

export class ArtifactHostError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ArtifactHostError'
  }
}

export function isValidToken(token: string): boolean {
  if (!TOKEN_PATTERN.test(token)) return false
  return !PREVIEW_LABEL_PATTERN.test(token) && !PREVIEW_HOST_PATTERN.test(token)
}

export function isValidSlug(slug: string): boolean {
  if (!SLUG_PATTERN.test(slug)) return false
  return !PREVIEW_LABEL_PATTERN.test(slug) && !PREVIEW_HOST_PATTERN.test(slug)
}

export function artifactHostOf(args: { token: string; slug: string; domain: string }): string {
  if (!isValidToken(args.token))
    throw new ArtifactTokenError(`invalid artifact token: ${args.token}`)
  if (!isValidSlug(args.slug)) throw new ArtifactSlugError(`invalid artifact slug: ${args.slug}`)
  const host = `${args.token}-${args.slug}.${args.domain}`
  if (PREVIEW_HOST_PATTERN.test(host)) {
    throw new ArtifactHostError(`artifact host collides with a preview host: ${host}`)
  }
  if (host.length > ARTIFACT_HOST_MAX_LENGTH) {
    throw new ArtifactHostError(`artifact host exceeds ${ARTIFACT_HOST_MAX_LENGTH} chars: ${host}`)
  }
  return host
}
