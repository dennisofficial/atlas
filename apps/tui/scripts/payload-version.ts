import { compareSemver, versionFromTag, type Semver } from '@dltech/atlas-core'

export function payloadVersion(args: {
  headTags: readonly string[]
  prefix: string
  next: Semver | null
}): Semver | null {
  let exact: Semver | null = null
  for (const tag of args.headTags) {
    const version = versionFromTag({ tag, prefix: args.prefix })
    if (version === null) continue
    if (exact === null || compareSemver(version, exact) > 0) exact = version
  }
  return exact ?? args.next
}
