import { artifactHostOf } from '@dltech/atlas-artifacts'

export const artifactUrlOf = (args: { token: string; slug: string; domain: string }): string =>
  `https://${artifactHostOf(args)}`
