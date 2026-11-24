import {
  compareSemver,
  formatSemver,
  isNewerSemver,
  parseSemver,
  versionFromTag,
  type Semver,
} from '@dltech/atlas-core'

import { buildInfo, EBuildKind } from '../build/info'
import {
  acquireStagingLock,
  installedNotice,
  latestReleasePathFor,
  publishLatestRelease,
  readLatestRelease,
  shouldPublishLatest,
} from '../build/latest-release-state'
import { EStageOutcome, realSelfUpdatePorts, stageUpdate } from '../build/self-update'
import { repoRootOf, sourceStateStamp } from '../build/stamp'
import { ENoticeTone, notify } from '../ui/notice-store'

export const RELEASE_TAG_PREFIX = 'tui-v'

export const RELEASE_TAGS_URL = 'https://install.byatlas.io/releases/tags'

/**
 * A stageUpdate that outlives this gives up its claim: the download is bounded at 300s, so a
 * bounded-over-that call means a hang, and a hang that keeps the staging lock would block every
 * other tile from ever staging. Releasing on timeout lets the next tile retry.
 */
const STAGE_DEADLINE_MS = 360_000

const stageUpdateBounded = (
  args: Parameters<typeof stageUpdate>[0],
): ReturnType<typeof stageUpdate> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<{ readonly outcome: EStageOutcome.Failed }>((resolve) => {
    timer = setTimeout(() => resolve({ outcome: EStageOutcome.Failed }), STAGE_DEADLINE_MS)
  })
  return Promise.race([stageUpdate(args), deadline]).finally(() => clearTimeout(timer))
}

export type ReleaseInfo = {
  readonly tag: string
  readonly version: Semver
}

export function latestRelease(args: {
  tags: readonly string[]
  prefix: string
}): ReleaseInfo | null {
  let best: ReleaseInfo | null = null
  for (const tag of args.tags) {
    const version = versionFromTag({ tag, prefix: args.prefix })
    if (version === null) continue
    if (best === null || compareSemver(version, best.version) > 0) best = { tag, version }
  }
  return best
}

export function releaseNotice(args: { current: string; latest: ReleaseInfo }): string | null {
  const current = parseSemver(args.current)
  if (current === null) return null
  if (!isNewerSemver({ candidate: args.latest.version, current })) return null

  return `atlas update: v${formatSemver(args.latest.version)} available (running v${formatSemver(current)})`
}

const run = async (cmd: readonly string[], timeoutMs = 15_000): Promise<string | null> => {
  try {
    const proc = Bun.spawn([...cmd], { stdout: 'pipe', stderr: 'ignore' })
    const timer = setTimeout(() => proc.kill(), timeoutMs)
    timer.unref?.()
    const text = await new Response(proc.stdout).text()
    const code = await proc.exited
    clearTimeout(timer)
    return code === 0 ? text : null
  } catch {
    return null
  }
}

export function parseMirrorTags(input: unknown): readonly string[] | null {
  if (typeof input !== 'object' || input === null) return null
  const tags = Reflect.get(input, 'tags')
  if (!Array.isArray(tags)) return null
  const named = tags.filter((tag): tag is string => typeof tag === 'string' && tag.length > 0)
  return named.length === 0 ? null : named
}

async function mirroredTags(): Promise<readonly string[] | null> {
  try {
    const res = await fetch(RELEASE_TAGS_URL, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return null
    return parseMirrorTags(await res.json())
  } catch {
    return null
  }
}

async function releaseTagsOf(repo: string): Promise<readonly string[] | null> {
  const mirrored = await mirroredTags()
  if (mirrored !== null && mirrored.length > 0) return mirrored
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=50`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return null

    const releases: unknown = await res.json()
    if (!Array.isArray(releases)) return null

    const tags: string[] = []
    for (const release of releases) {
      if (typeof release !== 'object' || release === null) continue
      const tag = (release as Record<string, unknown>).tag_name
      if (typeof tag === 'string' && tag.length > 0) tags.push(tag)
    }
    return tags
  } catch {
    return null
  }
}

export function sourceBehindNotice(args: { behind: number; upstream: string }): string | null {
  if (args.behind <= 0) return null

  const commits = args.behind === 1 ? '1 commit' : `${args.behind} commits`
  return `atlas-dev is ${commits} behind ${args.upstream} — git pull in the atlas checkout to update`
}

export type SourceBehind = {
  readonly behind: number
  readonly upstream: string
}

async function probeSourceBehind(repo: string): Promise<SourceBehind | null> {
  await run(['git', '-C', repo, 'fetch', '--quiet'])

  const upstream = await run(['git', '-C', repo, 'rev-parse', '--abbrev-ref', '@{upstream}'])
  if (upstream === null) return null

  const count = await run(['git', '-C', repo, 'rev-list', '--count', 'HEAD..@{upstream}'])
  const behind = count === null ? Number.NaN : Number(count.trim())
  if (Number.isNaN(behind)) return null

  return { behind, upstream: upstream.trim() }
}

export async function checkForUpdate(args: { home: string }): Promise<void> {
  const build = buildInfo()

  if (build.kind === EBuildKind.Source) {
    if (process.env.ATLAS_DEV !== '1') return

    const repo = await repoRootOf(import.meta.dirname)
    if (repo === null) return

    const state = await probeSourceBehind(repo)
    if (state === null) return

    const text = sourceBehindNotice(state)
    if (text === null) return

    notify({ key: 'source-behind', tone: ENoticeTone.Info, sticky: true, text })
    return
  }

  if (build.kind === EBuildKind.Dev) {
    const stamp = await sourceStateStamp({ repo: build.repo })
    if (stamp === null || stamp === build.stamp) return

    notify({
      key: 'build-stale',
      tone: ENoticeTone.Info,
      sticky: true,
      text: 'this atlas build is stale — the source tree has moved; bun run build to refresh',
    })
    return
  }

  if (build.kind !== EBuildKind.Release || build.releaseRepo === null) return

  const sharedPath = latestReleasePathFor(args.home)

  const published = await readLatestRelease(sharedPath)
  if (published !== null && releaseStaged({ running: build.version, staged: published.version })) {
    notify({
      key: 'release-staged',
      tone: ENoticeTone.Success,
      sticky: true,
      text: installedNotice(published.version),
    })
    return
  }

  const tags = await releaseTagsOf(build.releaseRepo)
  if (tags === null) return

  const latest = latestRelease({ tags, prefix: RELEASE_TAG_PREFIX })
  if (latest === null) return

  const text = releaseNotice({ current: build.version, latest })
  if (text === null) return

  const version = formatSemver(latest.version)
  if (!shouldPublishLatest({ candidate: version, published })) {
    notify({
      key: 'release-staged',
      tone: ENoticeTone.Success,
      sticky: true,
      text: installedNotice(version),
    })
    return
  }

  const lock = await acquireStagingLock({ path: sharedPath })
  if (lock === null) {
    const waited = await readLatestRelease(sharedPath)
    if (waited !== null && releaseStaged({ running: build.version, staged: waited.version })) {
      notify({
        key: 'release-staged',
        tone: ENoticeTone.Success,
        sticky: true,
        text: installedNotice(waited.version),
      })
      return
    }

    notify({ key: 'release-available', tone: ENoticeTone.Info, sticky: true, text })
    return
  }

  try {
    const staged = await stageUpdateBounded({
      tag: latest.tag,
      version,
      repo: build.releaseRepo,
      execPath: process.execPath,
      platform: process.platform,
      arch: process.arch,
      ports: realSelfUpdatePorts(),
    })

    if (staged.outcome === EStageOutcome.Staged || staged.outcome === EStageOutcome.AlreadyStaged) {
      await publishLatestRelease({ path: sharedPath, version: staged.version, tag: latest.tag })
      notify({
        key: 'release-staged',
        tone: ENoticeTone.Success,
        sticky: true,
        text: installedNotice(staged.version),
      })
      return
    }
  } finally {
    await lock.release()
  }

  notify({ key: 'release-available', tone: ENoticeTone.Info, sticky: true, text })
}

export function releaseStaged(args: { running: string; staged: string | null }): boolean {
  if (args.staged === null) return false

  const running = parseSemver(args.running)
  const staged = parseSemver(args.staged)
  if (running === null || staged === null) return false

  return isNewerSemver({ candidate: staged, current: running })
}
