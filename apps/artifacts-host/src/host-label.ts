import { isValidSlug, isValidToken } from '@dltech/atlas-artifacts'

export type HostLabel = { token: string; slug: string }

const HOST_PORT = /:\d{1,5}$/

const withoutPort = (host: string): string => host.trim().toLowerCase().replace(HOST_PORT, '')

const labelInDomain = ({ bare, domain }: { bare: string; domain: string }): string | null => {
  const suffix = `.${domain.toLowerCase()}`
  if (!bare.endsWith(suffix)) return null
  const label = bare.slice(0, -suffix.length)
  return label.includes('.') ? null : label
}

const firstLabelOf = (bare: string): string | null => {
  const [first] = bare.split('.')
  return first === undefined || first.length === 0 ? null : first
}

const labelOfParts = (label: string): HostLabel | null => {
  const dash = label.indexOf('-')
  if (dash === -1) return null
  const token = label.slice(0, dash)
  const slug = label.slice(dash + 1)
  if (!isValidToken(token) || !isValidSlug(slug)) return null
  return { token, slug }
}

export function labelOf({
  host,
  domain,
}: {
  host: string
  domain: string | undefined
}): HostLabel | null {
  const bare = withoutPort(host)
  if (bare.length === 0) return null
  const label = domain === undefined ? firstLabelOf(bare) : labelInDomain({ bare, domain })
  if (label === null) return null
  return labelOfParts(label)
}
