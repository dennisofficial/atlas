import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { compareSemver, parseSemver, versionFromTag } from '../packages/core/src/version/semver'
import { ECall, runGh } from './gh-retry'

type MacRelease = { tag: string; macVersion: string | null }
type MacReleasePlan = { markLatest: boolean; updateTags: string[] }

const stableVersion = (tag: string) => {
  const version = versionFromTag({ tag, prefix: 'tui-v' })
  return version?.prerelease === null ? version : null
}

export function macReleasePlan(args: {
  tag: string
  releases: readonly MacRelease[]
}): MacReleasePlan {
  const source = stableVersion(args.tag)
  if (source === null) throw new Error(`invalid Mac release tag: ${args.tag}`)
  const newer = args.releases.flatMap((release) => {
    const version = stableVersion(release.tag)
    return version !== null && compareSemver(version, source) > 0 ? [{ ...release, version }] : []
  })
  const updateTags = newer
    .sort((left, right) => compareSemver(left.version, right.version))
    .filter((release) => {
      if (release.macVersion === null) return false
      const macVersion = parseSemver(release.macVersion)
      if (macVersion === null) throw new Error(`invalid Mac version on ${release.tag}`)
      return compareSemver(macVersion, source) < 0
    })
    .map((release) => release.tag)
  return { markLatest: newer.length === 0, updateTags }
}

export function manifestVersion(body: string): string {
  const value = /^version:\s*["']?([^\s"']+)["']?\s*$/m.exec(body)?.[1]
  if (value === undefined || parseSemver(value) === null)
    throw new Error('invalid Mac manifest version')
  return value
}

const capture = (cmd: string[]): string => {
  const result = Bun.spawnSync({ cmd, stdout: 'pipe', stderr: 'inherit' })
  if (result.exitCode !== 0) throw new Error(`${cmd.join(' ')} failed (${result.exitCode})`)
  return result.stdout.toString()
}

const run = (cmd: string[]): void => {
  const result = Bun.spawnSync({ cmd, stdout: 'inherit', stderr: 'inherit' })
  if (result.exitCode !== 0) throw new Error(`${cmd.join(' ')} failed (${result.exitCode})`)
}

type GithubRelease = {
  tag_name: string
  draft: boolean
  prerelease: boolean
  assets: { name: string }[]
}

async function releasesWithMacVersions(args: {
  repo: string
  tag: string
  dir: string
}): Promise<MacRelease[]> {
  const pages = JSON.parse(
    capture(['gh', 'api', '--paginate', '--slurp', `repos/${args.repo}/releases?per_page=100`]),
  ) as GithubRelease[][]
  const source = stableVersion(args.tag)
  if (source === null) throw new Error(`invalid Mac release tag: ${args.tag}`)
  const releases: MacRelease[] = []
  for (const release of pages.flat()) {
    if (release.draft || release.prerelease) continue
    const version = stableVersion(release.tag_name)
    if (version === null) continue
    let macVersion: string | null = null
    if (
      compareSemver(version, source) > 0 &&
      release.assets.some((asset) => asset.name === 'latest-mac.yml')
    ) {
      const dir = join(args.dir, release.tag_name)
      run([
        'gh',
        'release',
        'download',
        release.tag_name,
        '--repo',
        args.repo,
        '--pattern',
        'latest-mac.yml',
        '--dir',
        dir,
      ])
      macVersion = manifestVersion(await Bun.file(join(dir, 'latest-mac.yml')).text())
    }
    releases.push({ tag: release.tag_name, macVersion })
  }
  return releases
}

async function main(): Promise<void> {
  const [tag, assetDir] = process.argv.slice(2)
  const repo = process.env.GITHUB_REPOSITORY
  if (!tag || !assetDir || !repo)
    throw new Error('usage: GITHUB_REPOSITORY=<repo> publish-mac-release <tag> <asset-dir>')
  const version = manifestVersion(await Bun.file(join(assetDir, 'latest-mac.yml')).text())
  if (`tui-v${version}` !== tag) throw new Error(`Mac manifest version does not match ${tag}`)
  const assets = [...new Bun.Glob('*.{dmg,zip}').scanSync({ cwd: assetDir })]
  if (
    !assets.some((asset) => asset.endsWith('.dmg')) ||
    !assets.some((asset) => asset.endsWith('.zip'))
  )
    throw new Error('Mac release needs a dmg and zip')
  assets.push('latest-mac.yml')
  const dir = await mkdtemp(join(tmpdir(), 'atlas-mac-publish-'))
  try {
    const releases = await releasesWithMacVersions({ repo, tag, dir })
    const plan = macReleasePlan({ tag, releases })
    const updated = [tag, ...plan.updateTags]
    for (const target of updated) {
      await runGh({
        call: ECall.Upload,
        argv: [
          'gh',
          'release',
          'upload',
          target,
          ...assets.map((asset) => resolve(assetDir, asset)),
          '--clobber',
          '--repo',
          repo,
        ],
      })
    }
    if (plan.markLatest) run(['gh', 'release', 'edit', tag, '--latest', '--repo', repo])
    const latest = capture([
      'gh',
      'release',
      'view',
      '--repo',
      repo,
      '--json',
      'tagName',
      '-q',
      '.tagName',
    ]).trim()
    for (const target of updated.filter((target) => target !== latest))
      run(['bun', 'scripts/mirror-release.ts', target])
    run(['bun', 'scripts/mirror-release.ts', latest, '--latest'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

if (import.meta.main) await main()
