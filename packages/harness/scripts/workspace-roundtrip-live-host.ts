import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { DIVERGED_KEYS, FEATURE_KEY, probeFilesOf, commitFileOf, type LiveCheckoutSpec } from './workspace-roundtrip-live-family'
import type { LiveFixture } from './workspace-roundtrip-live-fixture'
import { liveGit, liveGitRaw } from './workspace-roundtrip-live-git'
import { assertFiles, assertSameTree, inspectHostTree, type TreeState } from './workspace-roundtrip-live-inspect'
import type { HostBaseline } from './workspace-roundtrip-live-cloud'
import { assertPlacement, expectedPlacements, MAIN_KEY, ownedSpecs } from './workspace-roundtrip-live-placement'

const SUFFIXED = /-[0-9a-f]{4}$/
const hostIndependent = (spec: LiveCheckoutSpec): string => `host independent ${spec.key}\n`

export async function divergeHost(fixture: LiveFixture): Promise<void> {
  await liveGit({ cwd: fixture.repository, args: ['worktree', 'prune'] })
  for (const spec of ownedSpecs(fixture).filter((candidate) => DIVERGED_KEYS.includes(candidate.key))) {
    if (!existsSync(spec.path)) await liveGit({ cwd: fixture.repository, args: ['worktree', 'add', spec.path, spec.branch] })
    await writeFile(join(spec.path, 'file.txt'), hostIndependent(spec))
  }
  await writeFile(join(fixture.repository, 'host-independent.txt'), 'host main stays\n')
}

async function registeredPaths(repository: string): Promise<string[]> {
  const listing = await liveGitRaw({ cwd: repository, args: ['worktree', 'list', '--porcelain'] })
  return listing.split('\n').filter((line) => line.startsWith('worktree ')).map((line) => line.slice('worktree '.length))
}

async function locateRestored(args: { fixture: LiveFixture; spec: LiveCheckoutSpec; registered: readonly string[] }): Promise<string> {
  const diverged = DIVERGED_KEYS.includes(args.spec.key)
  const holders: string[] = []
  for (const path of args.registered) {
    if (path === args.fixture.repository || diverged && path === args.spec.path) continue
    const holds = await liveGit({ cwd: path, args: ['cat-file', '-e', `HEAD:${commitFileOf(args.spec)}`] }).then(() => true, () => false)
    if (holds) holders.push(path)
  }
  const [only] = holders
  if (holders.length !== 1 || only === undefined) throw new Error(`expected exactly one restored host checkout for ${args.spec.key}, found ${holders.length}`)
  if (diverged ? !SUFFIXED.test(only) : only !== args.spec.path) throw new Error(`${args.spec.key} landed at an unexpected host path: ${only}`)
  return only
}

export async function verifyHostArrival(args: { fixture: LiveFixture; baseline: HostBaseline; cloudAfter: Record<string, TreeState> }): Promise<Map<string, string>> {
  const { fixture, baseline } = args
  const registered = await registeredPaths(fixture.repository)
  const located = new Map<string, string>()
  for (const spec of ownedSpecs(fixture)) {
    const path = await locateRestored({ fixture, spec, registered })
    located.set(spec.key, path)
    const cloud = args.cloudAfter[spec.key]
    if (cloud === undefined) throw new Error(`no cloud state recorded for ${spec.key}`)
    const host = await inspectHostTree({ path, rels: probeFilesOf(spec) })
    assertSameTree({ label: `restored ${spec.key}`, actual: host, expected: cloud })
    assertFiles({ label: `restored ${spec.key}`, actual: host.files, expected: cloud.files, ignoreAbsent: true })
  }
  for (const placement of expectedPlacements({ fixture, pathOf: (key) => located.get(key) ?? '' })) {
    await fixture.local.log.refresh({ threadId: placement.threadId })
    assertPlacement({ events: await fixture.local.log.readOwn({ threadId: placement.threadId }), launchDirectory: fixture.repository, expected: placement, where: 'host' })
  }
  return located
}

export async function verifyEventIdentity(args: { fixture: LiveFixture; baseline: HostBaseline }): Promise<void> {
  for (const threadId of args.fixture.threadIds) {
    await args.fixture.local.log.refresh({ threadId })
    const after = (await args.fixture.local.log.readOwn({ threadId })).map((event) => event.id as string)
    const before = args.baseline.eventIds.get(threadId) ?? []
    let cursor = 0
    for (const id of before) {
      cursor = after.indexOf(id, cursor)
      if (cursor === -1) throw new Error(`thread ${threadId} lost or reordered event ${id}`)
    }
  }
}

export async function verifyHostIndependence(args: { fixture: LiveFixture; baseline: HostBaseline }): Promise<void> {
  const { fixture, baseline } = args
  for (const spec of ownedSpecs(fixture).filter((candidate) => DIVERGED_KEYS.includes(candidate.key))) {
    if (await readFile(join(spec.path, 'file.txt'), 'utf8') !== hostIndependent(spec)) throw new Error(`the original host checkout ${spec.key} was overwritten`)
  }
  if (await readFile(join(fixture.repository, 'host-independent.txt'), 'utf8') !== 'host main stays\n') throw new Error('host main was overwritten')
  const unrelated = baseline.trees.get(fixture.hostUnrelated.key)
  if (unrelated === undefined) throw new Error('the unrelated host checkout had no baseline')
  assertSameTree({ label: 'unrelated host checkout', actual: await inspectHostTree({ path: fixture.hostUnrelated.path, rels: probeFilesOf(fixture.hostUnrelated) }), expected: unrelated, withFiles: true })
  if (existsSync(join(fixture.directory, 'ephemeral-clone')) || existsSync(join(fixture.repository, 'ephemeral-clone'))) throw new Error('an ephemeral sibling was brought home')
  if (!baseline.trees.has(MAIN_KEY) || !baseline.trees.has(FEATURE_KEY)) throw new Error('the host baseline is incomplete')
}

export async function assertNoCloudCheckoutOnHost(args: { fixture: LiveFixture; marker: string }): Promise<void> {
  for (const path of await registeredPaths(args.fixture.repository)) {
    if (existsSync(join(path, args.marker))) throw new Error('the unrelated cloud checkout bytes reached the host')
  }
}
