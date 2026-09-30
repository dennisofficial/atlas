import { BadRequestException } from '@nestjs/common'

const CLIENT_TOKEN_PATTERN = /^[0-9a-f]{64}$/

const MAX_SERVE_URL_LENGTH = 253

const SERVE_HOST_PATTERN = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)*\.vercel\.run$/

const invalid = (reason: string): never => {
  throw new BadRequestException(`serveUrl ${reason}`)
}

export function assertPublicServeUrl(value: string): void {
  if (value.length > MAX_SERVE_URL_LENGTH) invalid('is too long')
  const url = parseUrl(value)
  if (url.protocol !== 'https:') invalid('must use https')
  if (url.username !== '' || url.password !== '') invalid('must not carry credentials')
  if (url.hash !== '') invalid('must not carry a fragment')
  const hostname = url.hostname.toLowerCase()
  if (hostname.endsWith('.') || hostname.split('..').length > 1) invalid('has a malformed host')
  if (!SERVE_HOST_PATTERN.test(hostname)) invalid('must be a Vercel sandbox endpoint')
}

const parseUrl = (value: string): URL => {
  try {
    return new URL(value)
  } catch {
    return invalid('must be a valid URL')
  }
}

export function assertClientTokenShape(token: string): void {
  if (!CLIENT_TOKEN_PATTERN.test(token)) {
    throw new BadRequestException('clientToken must be 32 bytes hex-encoded')
  }
}
