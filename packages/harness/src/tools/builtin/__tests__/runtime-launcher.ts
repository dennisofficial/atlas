import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toThreadId, type ThreadId } from '@dltech/atlas-core'

import { LocalProcessPort } from '../../../execution/local-process'
import { HookChain, type HookChainSource } from '../../../hooks/registry'
import { DurableShellLauncher } from '../../../shells/durable-launcher'
import { BunShellRegistry } from '../../../shells/shell-registry'
import { ShellStorage } from '../../../shells/storage'
import { prepareSupervisorLauncher, type SupervisorLauncher } from '../../../shells/supervisor-launch'
import { SessionRegistry } from '../../../store/sessions/registry'
import { RandomIds, SystemClock } from '../../../store'
import { RecordingLog } from '../../../shells/__tests__/shell-registry-log'

export type RuntimeSuite = {
  root: string
  home: string
  threadId: ThreadId
  shells: BunShellRegistry
  log: RecordingLog | undefined
}

const started: { session: SessionRegistry; sessionDir: string; threadId: ThreadId }[] = []
let supervisor: SupervisorLauncher | undefined

export async function discardSuites(suites: RuntimeSuite[]): Promise<void> {
  for (const suite of suites.splice(0)) {
    await suite.shells.closeAll()
    rmSync(suite.root, { recursive: true, force: true })
    rmSync(suite.home, { recursive: true, force: true })
  }
}

export async function discardThreads(): Promise<void> {
  for (const entry of started.splice(0)) {
    entry.session.forgetThread({ sessionDir: entry.sessionDir, threadId: entry.threadId })
  }
}

const noHooks: HookChainSource = () => new HookChain({})

export async function openRuntimeRegistry({
  root = mkdtempSync(join(tmpdir(), 'atlas-tool-runtime-')),
  home = mkdtempSync(join(tmpdir(), 'atlas-tool-home-')),
  threadId = toThreadId('thread-1'),
  hooks = noHooks,
  withLog = false,
}: {
  root?: string | undefined
  home?: string | undefined
  threadId?: ThreadId | undefined
  hooks?: HookChainSource | undefined
  withLog?: boolean | undefined
} = {}): Promise<RuntimeSuite> {
  const session = new SessionRegistry(home)
  const storage = new ShellStorage({ sessions: session })
  supervisor ??= await prepareSupervisorLauncher({ home })
  const sessionDir = join(home, 'sessions', threadId)
  mkdirSync(sessionDir, { recursive: true })
  session.registerThread({ sessionDir, threadId })
  started.push({ session, sessionDir, threadId })

  const log = withLog ? new RecordingLog() : undefined
  const shells = new BunShellRegistry({
    root,
    clock: new SystemClock(),
    hooks,
    launcher: new DurableShellLauncher({
      storage,
      sessions: session,
      processes: new LocalProcessPort(),
      supervisor: () => Promise.resolve(supervisor as SupervisorLauncher),
      now: () => new SystemClock().now(),
    }),
    log,
    ids: log === undefined ? undefined : new RandomIds(),
  })
  return { root, home, threadId, shells, log }
}
