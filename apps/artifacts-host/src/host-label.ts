import { subdomainOfLabel, type Subdomain } from '@dltech/atlas-artifacts'

export type HostSubdomain = Subdomain

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

export function subdomainOf({
  host,
  domain,
}: {
  host: string
  domain: string | undefined
}): HostSubdomain | null {
  const bare = withoutPort(host)
  if (bare.length === 0) return null
  const label = domain === undefined ? firstLabelOf(bare) : labelInDomain({ bare, domain })
  if (label === null) return null
  return subdomainOfLabel(label)
}
