import type { Sandbox } from '@vercel/sandbox'
import type { Event, ThreadId } from '@dltech/atlas-core'
import type { RestoredWorkspace } from '../src/index'

import { CLOUD_EDITS } from './workspace-roundtrip-live-family'
import type { LiveFixture } from './workspace-roundtrip-live-fixture'
import { assertFiles, assertSameTree, inspectCloudTrees, inspectHostTree, type TreeProbe, type TreeState } from './workspace-roundtrip-live-inspect'
import { filesAfterLift, probeFilesOf } from './workspace-roundtrip-live-family'
import { assertPlacement, cloudPathsOf, expectedPlacements, MAIN_KEY, ownedSpecs } from './workspace-roundtrip-live-placement'
import { lastBashOutput, steerSettledTeammate } from './workspace-roundtrip-live-steer'
import type { CloudChannel } from '../src/index'

export type HostBaseline = { trees: Map<string, TreeState>; eventIds: Map<ThreadId, string[]> }

const MAIN_RELS = ['file.txt']

export async function captureBaseline(fixture: LiveFixture): Promise<HostBaseline> {
  const trees = new Map<string, TreeState>()
  for (const spec of [...ownedSpecs(fixture), fixture.hostUnrelated]) trees.set(spec.key, await inspectHostTree({ path: spec.path, rels: probeFilesOf(spec) }))
  trees.set(MAIN_KEY, await inspectHostTree({ path: fixture.repository, rels: MAIN_RELS }))
  const eventIds = new Map<ThreadId, string[]>()
  for (const threadId of fixture.threadIds) eventIds.set(threadId, (await fixture.local.log.readOwn({ threadId })).map((event) => event.id))
  return { trees, eventIds }
}

export async function inspectOwnedCloud(args: { fixture: LiveFixture; sandbox: Sandbox; restored: RestoredWorkspace; paths: ReadonlyMap<string, string> }): Promise<Record<string, TreeState>> {
  const owned: TreeProbe[] = ownedSpecs(args.fixture).map((spec) => ({ key: spec.key, path: args.paths.get(spec.key) ?? '', rels: probeFilesOf(spec) }))
  return inspectCloudTrees({ sandbox: args.sandbox, probes: [...owned, { key: MAIN_KEY, path: args.restored.repository ?? '', rels: MAIN_RELS }] })
}

export async function verifyCloudTrees(args: { fixture: LiveFixture; sandbox: Sandbox; restored: RestoredWorkspace; baseline: HostBaseline }): Promise<Map<string, string>> {
  const paths = cloudPathsOf({ fixture: args.fixture, restored: args.restored })
  const cloud = await inspectOwnedCloud({ ...args, paths })
  for (const key of [...paths.keys(), MAIN_KEY]) {
    const actual = cloud[key]
    const expected = args.baseline.trees.get(key)
    if (actual === undefined || expected === undefined) throw new Error(`no state to compare for ${key}`)
    assertSameTree({ label: `cloud ${key}`, actual, expected })
  }
  for (const spec of ownedSpecs(args.fixture)) assertFiles({ label: `cloud ${spec.key}`, actual: cloud[spec.key]?.files ?? {}, expected: filesAfterLift(spec) })
  return paths
}

export async function verifyCloudThreads(args: { fixture: LiveFixture; restored: RestoredWorkspace; paths: ReadonlyMap<string, string>; readEvents: (threadId: ThreadId) => Promise<Event[]>; where: string }): Promise<void> {
  const expected = expectedPlacements({ fixture: args.fixture, pathOf: (key) => args.paths.get(key) ?? '' })
  for (const placement of expected) {
    assertPlacement({ events: await args.readEvents(placement.threadId), launchDirectory: args.restored.repository ?? '', expected: placement, where: args.where })
  }
}

export async function steerEveryTeammate(args: { fixture: LiveFixture; channel: CloudChannel; paths: ReadonlyMap<string, string>; readEvents: (threadId: ThreadId) => Promise<Event[]> }): Promise<void> {
  const feature = args.paths.get(args.fixture.feature.key) ?? ''
  for (const teammate of args.fixture.teammates) {
    const before = new Set((await args.readEvents(teammate.threadId)).map((event) => event.id))
    await steerSettledTeammate({ channel: args.channel, rootId: args.fixture.threadId, agentId: teammate.threadId, text: 'Verify the current directory and dirty Git status with one bash call.' })
    const output = lastBashOutput({ events: await args.readEvents(teammate.threadId), before })
    const expected = teammate.exitsKeep ? feature : args.paths.get(teammate.spec.key)
    if (output === undefined || expected === undefined || !output.includes(`${expected}\\n`)) throw new Error(`teammate ${teammate.spec.key} did not run bash in its own directory`)
    console.log(JSON.stringify({ phase: 'teammate-resumed', key: teammate.spec.key, exitedRetained: teammate.exitsKeep }))
  }
}

const EDIT_SCRIPT = `import json,pathlib,subprocess,sys
spec=json.loads(sys.argv[1])
for root,files in spec["edits"].items():
    for rel,content in files.items(): (pathlib.Path(root)/rel).write_text(content)
repo=pathlib.Path(spec["repository"]);sibling=repo.parent/"ephemeral-clone"
subprocess.run(["git","clone",str(repo),str(sibling)],check=True)
(sibling/"new.txt").write_text("ephemeral dirty\\n")`

export async function editInCloud(args: { sandbox: Sandbox; paths: ReadonlyMap<string, string>; repository: string }): Promise<void> {
  const edits = Object.fromEntries(Object.entries(CLOUD_EDITS).map(([key, files]) => [args.paths.get(key) ?? '', files]))
  const run = await args.sandbox.runCommand({ cmd: 'python3', args: ['-c', EDIT_SCRIPT, JSON.stringify({ edits, repository: args.repository })], timeoutMs: 60000 })
  if (run.exitCode !== 0) throw new Error(await run.stderr())
}

export const UNRELATED_CLOUD_BRANCH = 'unrelated-cloud'

const UNRELATED_SCRIPT = `import pathlib,subprocess,sys
repo=pathlib.Path(sys.argv[1]);p=repo/".atlas"/"worktrees"/sys.argv[2]
def git(*a,cwd=repo): return subprocess.run(["git","-c","user.name=Probe","-c","user.email=probe@example.invalid",*a],cwd=cwd,check=True,capture_output=True,text=True).stdout.strip()
git("worktree","add","-b",sys.argv[2],str(p))
(p/"unrelated.txt").write_text("unrelated cloud bytes\\n")
git("add","unrelated.txt",cwd=p);git("commit","-m","unrelated cloud",cwd=p)
print(str(p)+"\\n"+git("rev-parse","HEAD",cwd=p))`

export async function createUnrelatedCloudCheckout(args: { sandbox: Sandbox; repository: string }): Promise<{ path: string; head: string }> {
  const run = await args.sandbox.runCommand({ cmd: 'python3', args: ['-c', UNRELATED_SCRIPT, args.repository, UNRELATED_CLOUD_BRANCH], timeoutMs: 60000 })
  if (run.exitCode !== 0) throw new Error(await run.stderr())
  const [path, head] = (await run.stdout()).trim().split('\n')
  if (path === undefined || head === undefined) throw new Error('the unrelated cloud checkout was not created')
  return { path, head }
}

export async function unrelatedCloudCheckoutRemains(args: { sandbox: Sandbox; path: string; head: string }): Promise<boolean> {
  const run = await args.sandbox.runCommand({ cmd: 'sh', args: ['-c', `git -C ${JSON.stringify(args.path)} rev-parse HEAD && cat ${JSON.stringify(`${args.path}/unrelated.txt`)}`], timeoutMs: 30000 }).catch(() => undefined)
  if (run === undefined || run.exitCode !== 0) return false
  return (await run.stdout()) === `${args.head}\nunrelated cloud bytes\n`
}
