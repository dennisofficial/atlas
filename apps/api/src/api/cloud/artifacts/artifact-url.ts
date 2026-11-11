import { assertSubdomain } from '@dltech/atlas-artifacts'

export const artifactUrlOf = (args: { subdomain: string; domain: string }): string =>
  `https://${assertSubdomain(args.subdomain)}.${args.domain}`
