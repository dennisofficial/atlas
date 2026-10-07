import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ThreadId } from '@dltech/atlas-core'
import { EClientFrame, EClientRequest, JsonlEventLog, registryFor } from '@dltech/atlas-harness'
import { runGit } from '@dltech/atlas-harness'

import { JsonlThreadStore } from '../../../../packages/harness/src/store/sessions/thread-store'
import { CountingIds, SteppingClock } from '../../../../packages/harness/src/store/__tests__/harness'
import { createDirectWorkspace } from '../direct-workspace'
import { createWorkspaceSession } from '../workspace-session'
import type { ServeApp } from '../serve-app'
import { answerWorkspaceTransfer } from '../workspace-ops'

export const SOURCE_SESSION = 'session-source'

const roots: string[] = []

export const removeFamilyFixtures = async (): Promise<void> => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
}

export const git = async ({ cwd, args }: { cwd: string; args: readonly string[] }): Promise<string> => {
  const run = await runGit({
    args: ['-c', 'user.name=Spec', '-c', 'user.email=spec@example.com', '-c', 'commit.gpgsign=false', ...args],
    cwd,
  })
  if (!run.ok) throw new Error(`git ${args.join(' ')}: ${run.stderr || run.stdout}`)
  return run.stdout.trim()
}

export type FamilyFixture = Awaited<ReturnType<typeof familyFixture>>

export async function familyFixture(args: { sourceSessionId?: string | undefined } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'atlas-family-cleanup-')))
  roots.push(root)
  const repo = join(root, 'repo')
  await mkdir(repo, { recursive: true })
  await git({ cwd: repo, args: ['init', '--initial-branch=main'] })
  await writeFile(join(repo, '.gitignore'), '.atlas/\n')
  await writeFile(join(repo, 'app.ts'), 'export const one = 1\n')
  await git({ cwd: repo, args: ['add', '-A'] })
  await git({ cwd: repo, args: ['commit', '-m', 'seed'] })

  const home = join(root, 'home')
  await mkdir(join(home, 'bootstrap'), { recursive: true })
  const registry = registryFor({ home })
  const clock = new SteppingClock()
  const ids = new CountingIds('fam')
  const log = new JsonlEventLog(home, registry, clock, ids)
  const threads = new JsonlThreadStore(home, registry, clock, ids, log)
  const rootThread = (await threads.create({ title: 'root', workspace: repo, repo })).id
  await log.append({ threadId: rootThread, runId: ids.nextRunId(), drafts: [{ type: 'nudge', text: 'tick', lifetimeSteps: 1 }] })

  const linked = async (name: string): Promise<string> => {
    const path = join(repo, '.atlas', 'worktrees', name)
    await git({ cwd: repo, args: ['worktree', 'add', path, '-b', name] })
    return realpath(path)
  }
  const childCheckout = await linked('second')
  const childThread = (await threads.create({ agent: { spawnedBy: rootThread, type: 'builder' }, workspace: childCheckout, repo })).id
  await log.append({ threadId: childThread, runId: ids.nextRunId(), drafts: [{ type: 'nudge', text: 'tick', lifetimeSteps: 1 }] })
  const enter = async ({ threadId, path }: { threadId: ThreadId; path: string }): Promise<void> => {
    await log.append({ threadId, runId: ids.nextRunId(), drafts: [{ type: 'worktree-entered', path, branch: path.split('/').at(-1) ?? 'work' }] })
  }

  const direct = createDirectWorkspace({ driveHome: home, destination: join(home, 'workspace') })
  let busy = false
  const stops: string[] = []
  const app: Pick<ServeApp, 'log' | 'stopWorkspaceProcesses' | 'family'> & Pick<ServeApp, 'threads'> = {
    log,
    threads,
    stopWorkspaceProcesses: async () => { stops.push('stop') },
    family: undefined,
  }
  const session = createWorkspaceSession({
    direct,
    driveHome: home,
    threadId: rootThread,
    launchDirectory: () => repo,
    app,
    sourceSessionId: 'sourceSessionId' in args ? args.sourceSessionId : SOURCE_SESSION,
    dormant: false,
    startChildren: async () => undefined,
  })
  const confirm = (generation: string) =>
    answerWorkspaceTransfer({
      frame: { kind: EClientFrame.Request, id: 'confirm', op: EClientRequest.ConfirmWorkspaceCleanup, params: { generation } },
      busy: () => busy,
      confirmCleanup: session.confirmCleanup,
    })
  return {
    root, repo, home, rootThread, childThread, childCheckout, session, stops, linked, enter, confirm,
    setBusy: (value: boolean) => { busy = value },
  }
}
