import {
  SHIPPED_APP_DIRS,
  type WorkspaceManifest,
  affectedApps,
  formatSemver,
  nextReleaseVersion,
} from '@dltech/atlas-core'

import { RELEASE_TAG_PREFIX, latestRelease } from '../src/composition/update-check'

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies'] as const

function run(cmd: readonly string[]): string {
  const proc = Bun.spawnSync({ cmd: [...cmd], stdout: 'pipe', stderr: 'pipe' })
  if (proc.exitCode !== 0) {
    throw new Error(`${cmd.join(' ')} exited ${proc.exitCode}: ${proc.stderr.toString()}`)
  }
  return proc.stdout.toString()
}

function nonEmptyLines(text: string): readonly string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

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

function manifestAt(args: { dir: string; json: unknown }): WorkspaceManifest | null {
  const { json } = args
  if (typeof json !== 'object' || json === null) return null
  if (!('name' in json) || typeof json.name !== 'string') return null

  const dependencies = DEPENDENCY_FIELDS.flatMap((field) => {
    if (!(field in json)) return []
    const value: unknown = Reflect.get(json, field)
    return typeof value === 'object' && value !== null ? Object.keys(value) : []
  })
  return { dir: args.dir, name: json.name, dependencies }
}

async function workspaceManifests(): Promise<readonly WorkspaceManifest[]> {
  const paths = nonEmptyLines(
    run(['git', 'ls-files', 'apps/*/package.json', 'packages/*/package.json']),
  )
  const manifests = await Promise.all(
    paths.map(async (path) =>
      manifestAt({
        dir: path.slice(0, -'/package.json'.length),
        json: await Bun.file(path).json(),
      }),
    ),
  )
  return manifests.filter((manifest) => manifest !== null)
}

const latest = latestRelease({
  tags: releaseTags(),
  prefix: RELEASE_TAG_PREFIX,
})
const since = latest?.tag ?? null
const affected = affectedApps({
  manifests: await workspaceManifests(),
  apps: SHIPPED_APP_DIRS,
  changedPaths: changedPathsSince(since),
})
const next = nextReleaseVersion({
  current: latest?.version ?? null,
  subjects: subjectsSince(since),
  appsAffected: affected.length > 0,
})

console.error(
  `affected apps since ${since ?? 'the first commit'}: ${affected.join(', ') || 'none'}`,
)

if (next === null) {
  console.log('skip=true')
  process.exit(0)
}

console.log(`version=${formatSemver(next)}`)
console.log(`prev_tag=${latest?.tag ?? ''}`)
