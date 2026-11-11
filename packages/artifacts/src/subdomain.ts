import { z } from 'zod'

export const SUBDOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/

export const SUBDOMAIN_MAX_LENGTH = 63

export const SUBDOMAIN_LENGTH = 12

export const SUBDOMAIN_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567'

export class ArtifactSubdomainError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ArtifactSubdomainError'
  }
}

export const subdomainSchema = z.string().regex(SUBDOMAIN_PATTERN)

export type Subdomain = z.infer<typeof subdomainSchema>

export function isSubdomain(value: string): boolean {
  return value.length <= SUBDOMAIN_MAX_LENGTH && SUBDOMAIN_PATTERN.test(value)
}

export function assertSubdomain(value: string): Subdomain {
  if (!isSubdomain(value)) throw new ArtifactSubdomainError(`invalid artifact subdomain: ${value}`)
  return value
}

export function subdomainOfBytes(bytes: Uint8Array): string {
  const alphabet = SUBDOMAIN_ALPHABET
  const length = SUBDOMAIN_LENGTH
  const chars = Array.from({ length }, (_, index) => {
    const byte = bytes[index] ?? 0
    return alphabet[byte % alphabet.length] ?? 'a'
  })
  return chars.join('')
}

export function subdomainOfLabel(label: string): Subdomain | null {
  const normalized = label.trim().toLowerCase()
  return isSubdomain(normalized) ? normalized : null
}
