declare const ATLAS_VERSION: string | undefined
declare const ATLAS_RELEASE_REPO: string | undefined
declare const ATLAS_BUILD_SHA: string | undefined
declare const ATLAS_SERVE_SOURCE: string | undefined
declare const ATLAS_BUILD_REPO: string | undefined
declare const ATLAS_BUILD_STAMP: string | undefined

export enum EBuildKind {
  Release = 'release',
  Dev = 'dev',
  Source = 'source',
}

export type BuildInfo =
  | {
      readonly kind: EBuildKind.Release
      readonly version: string
      readonly releaseRepo: string | null
      /** The commit the release was cut from. */
      readonly buildSha: string | null
      /**
       * The serve source hash baked into this build — the stamp a matching baked serve carries
       * (`apps/serve/scripts/serve-source-stamp.sh`). Null on builds that predate it, which the
       * sandbox freshness check reads as "trust nothing baked".
       */
      readonly serveSource: string | null
    }
  | { readonly kind: EBuildKind.Dev; readonly repo: string; readonly stamp: string }
  | { readonly kind: EBuildKind.Source }

const present = (value: string | undefined): string | undefined =>
  value === undefined || value === '' ? undefined : value

export function clientVersionOf(build: BuildInfo): string {
  if (build.kind === EBuildKind.Release) return build.version
  if (build.kind === EBuildKind.Dev) return `dev+${build.stamp}`
  return 'dev'
}

export function clientVersionHeader(): string {
  return clientVersionOf(buildInfo())
}

export function versionLabelOf(build: BuildInfo): string {
  if (build.kind === EBuildKind.Release) return `v${build.version}`
  return clientVersionOf(build)
}

export function versionLabel(): string {
  return versionLabelOf(buildInfo())
}

export function buildInfo(): BuildInfo {
  const version = typeof ATLAS_VERSION === 'undefined' ? undefined : present(ATLAS_VERSION)
  if (version !== undefined) {
    const releaseRepo = typeof ATLAS_RELEASE_REPO === 'undefined' ? undefined : ATLAS_RELEASE_REPO
    const buildSha = typeof ATLAS_BUILD_SHA === 'undefined' ? undefined : present(ATLAS_BUILD_SHA)
    const serveSource =
      typeof ATLAS_SERVE_SOURCE === 'undefined' ? undefined : present(ATLAS_SERVE_SOURCE)
    return {
      kind: EBuildKind.Release,
      version,
      releaseRepo: releaseRepo ?? null,
      buildSha: buildSha ?? null,
      serveSource: serveSource ?? null,
    }
  }

  const repo = typeof ATLAS_BUILD_REPO === 'undefined' ? undefined : present(ATLAS_BUILD_REPO)
  const stamp = typeof ATLAS_BUILD_STAMP === 'undefined' ? undefined : present(ATLAS_BUILD_STAMP)
  if (repo !== undefined && stamp !== undefined) {
    return { kind: EBuildKind.Dev, repo, stamp }
  }

  return { kind: EBuildKind.Source }
}
