import {
  SHIPPED_APP_DIRS,
  affectedApps,
  formatSemver,
  nextReleaseVersion,
} from '@dltech/atlas-core'

import { payloadVersion } from './payload-version'
import { RELEASE_TAG_PREFIX, latestRelease } from '../src/boot/update-check'
import { nonEmptyLines, run, workspaceManifests } from '../../../scripts/workspace-manifests'

function releaseTags(): readonly string[] {
  return nonEmptyLines(run(['git', 'tag', '--list', `${RELEASE_TAG_PREFIX}*`]))
}

function subjectsSince(tag: string | null): readonly string[] {
  const range = tag === null ? [] : [`${tag}..HEAD`]
  return nonEmptyLines(run(['git', 'log', ...range, '--format=%s']))
}

function changedPathsSince(tag: string | null): readonly string[] {
  if (tag === null) return nonEmptyLines(run(['git', 'ls-files']))
  return nonEmptyLines(run(['git', 'diff', '--name-only', `${tag}..HEAD`]))
}

const latest = latestRelease({
  tags: releaseTags(),
  prefix: RELEASE_TAG_PREFIX,
})
const since = latest?.tag ?? null
const changed = changedPathsSince(since)
const affected = affectedApps({
  manifests: await workspaceManifests(),
  apps: SHIPPED_APP_DIRS,
  changedPaths: changed,
})
const computed = nextReleaseVersion({
  current: latest?.version ?? null,
  subjects: subjectsSince(since),
  appsAffected: affected.length > 0,
})

const next = payloadVersion({
  headTags: process.argv.includes('--prefer-head-tag')
    ? nonEmptyLines(run(['git', 'tag', '--points-at', 'HEAD', '--list', `${RELEASE_TAG_PREFIX}*`]))
    : [],
  prefix: RELEASE_TAG_PREFIX,
  next: computed,
})

console.error(
  `affected apps since ${since ?? 'the first commit'}: ${affected.join(', ') || 'none'}`,
)

const macChanged = affected.includes('apps/mac')
console.log(`mac=${macChanged ? 'true' : 'false'}`)

if (next === null) {
  console.log('skip=true')
  process.exit(0)
}

console.log(`version=${formatSemver(next)}`)
console.log(`prev_tag=${latest?.tag ?? ''}`)
