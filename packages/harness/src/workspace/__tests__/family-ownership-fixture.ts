import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EWorktreeExit, type EventDraft, type ThreadId } from '@dltech/atlas-core'

import { CountingIds, SteppingClock } from '../../store/__tests__/harness'
import { JsonlEventLog } from '../../store/sessions/event-log'
import { sessionDirectory } from '../../store/sessions/paths'
import { SessionRegistry } from '../../store/sessions/registry'
import { JsonlThreadStore } from '../../store/sessions/thread-store'

const made: string[] = []

export async function cleanupFixtures(): Promise<void> {
  await Promise.all(made.splice(0).map((path) => rm(path, { recursive: true, force: true })))
}

export async function tempRoot(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'atlas-family-')))
  made.push(root)
  return root
}

export async function git(args: readonly string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' })
  const [stdout, stderr, status] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  if (status !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${stderr}`)
  return stdout
}

export async function makeRepo({ root }: { root: string }): Promise<string> {
  const repo = join(root, 'repo')
  await mkdir(repo, { recursive: true })
  await git(['init', '-b', 'main'], repo)
  await git(['config', 'user.email', 'test@example.com'], repo)
  await git(['config', 'user.name', 'Test'], repo)
  await Bun.write(join(repo, 'README.md'), 'hello')
  await git(['add', '.'], repo)
  await git(['commit', '-m', 'initial'], repo)
  return repo
}

export async function addLinked({ repo, root, name }: { repo: string; root: string; name: string }): Promise<string> {
  const path = join(root, name)
  await git(['worktree', 'add', '-b', name, path], repo)
  return path
}

export async function removeLinked({ repo, path }: { repo: string; path: string }): Promise<void> {
  await git(['worktree', 'remove', '--force', path], repo)
}

export async function markerOf({ checkout }: { checkout: string }): Promise<string> {
  const gitDir = (await git(['rev-parse', '--path-format=absolute', '--git-dir'], checkout)).trim()
  return readFile(join(gitDir, 'atlas-checkout-id'), 'utf8')
}

export type Fixture = {
  home: string
  root: string
  repo: string
  registry: SessionRegistry
  log: JsonlEventLog
  threads: JsonlThreadStore
  ids: CountingIds
}

export async function openFixture(): Promise<Fixture> {
  const root = await tempRoot()
  const repo = await makeRepo({ root })
  const home = join(root, 'home')
  const registry = new SessionRegistry(home)
  const clock = new SteppingClock()
  const ids = new CountingIds('fam')
  const log = new JsonlEventLog(home, registry, clock, ids)
  return { home, root, repo, registry, log, threads: new JsonlThreadStore(home, registry, clock, ids, log), ids }
}

export const entered = ({ path }: { path: string }): EventDraft => ({ type: 'worktree-entered', path, branch: 'work' })

export const exited = ({ path, action, returnTo }: { path: string; action: EWorktreeExit; returnTo?: string }): EventDraft => ({
  type: 'worktree-exited',
  path,
  action,
  ...(returnTo === undefined ? {} : { returnTo }),
})

export const nudge = (): EventDraft => ({ type: 'nudge', text: 'tick', lifetimeSteps: 1 })

export function sessionDirOf({ fx, rootId }: { fx: Fixture; rootId: ThreadId }): string {
  return sessionDirectory({ home: fx.home, sessionId: rootId })
}

export async function startRoot({ fx }: { fx: Fixture }): Promise<ThreadId> {
  const root = await fx.threads.create({ title: 'root', workspace: fx.repo, repo: fx.repo })
  return root.id
}

export async function spawnChild({ fx, parent, workspace }: { fx: Fixture; parent: ThreadId; workspace?: string }): Promise<ThreadId> {
  const child = await fx.threads.create({
    agent: { spawnedBy: parent, type: 'builder' },
    workspace: workspace ?? fx.repo,
    repo: fx.repo,
  })
  return child.id
}

export async function appendTo({ fx, threadId, drafts }: { fx: Fixture; threadId: ThreadId; drafts: readonly EventDraft[] }): Promise<void> {
  await fx.log.append({ threadId, runId: fx.ids.nextRunId(), drafts })
}
