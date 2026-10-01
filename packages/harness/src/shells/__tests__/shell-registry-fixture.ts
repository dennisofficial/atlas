import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  EventLogPort,
  ProcessPort,
  stampDrafts,
  toEventId,
  toRunId,
  toThreadId,
  type ClockPort,
  type Event,
  type EventDraft,
  type EventOfType,
  type ThreadId,
} from '@dltech/atlas-core'

import { RandomIds } from '../../store/ids'

import { DockerProcessPort } from '../../execution/docker/docker-process'
import { liveDockerOptedIn } from '../../execution/docker/__tests__/live-docker'
import { DockerEngine } from '../../execution/docker/engine'
import {
  DEFAULT_DOCKER_SOCKET,
  DEFAULT_SANDBOX_IMAGE,
  worktreeLabel,
  type SandboxConfig,
} from '../../execution/docker/sandbox'
import { LocalProcessPort } from '../../execution/local-process'
import { HookChain, type HookChainSource } from '../../hooks/registry'
import { EShellStatus } from '../background-shell'
import { BunShellRegistry, type ShellRegistryPort } from '../shell-registry'

export const THREAD = toThreadId('thread-under-test')
export const ELSEWHERE = toThreadId('thread-next-door')

class SteppableClock implements ClockPort {
  private millis = Date.parse('2026-08-27T12:00:00.000Z')

  now(): string {
    return new Date(this.millis).toISOString()
  }

  advance(by: number): void {
    this.millis += by
  }
}

type EndedDraft = Omit<
  EventOfType<'background-shell-ended'>,
  keyof { id: 0; seq: 0; threadId: 0; runId: 0; depth: 0; at: 0 }
>

export function endedDraft(draft: EventDraft | undefined): EndedDraft {
  if (draft?.type !== 'background-shell-ended') {
    throw new Error(`expected a background-shell-ended draft, got ${draft?.type ?? 'nothing'}`)
  }
  return draft
}

type AwaitingInputDraft = Omit<
  EventOfType<'background-shell-awaiting-input'>,
  keyof { id: 0; seq: 0; threadId: 0; runId: 0; depth: 0; at: 0 }
>

export function awaitingInputDraft(draft: EventDraft | undefined): AwaitingInputDraft {
  if (draft?.type !== 'background-shell-awaiting-input') {
    throw new Error(
      `expected a background-shell-awaiting-input draft, got ${draft?.type ?? 'nothing'}`,
    )
  }
  return draft
}

type MatchedDraft = Omit<
  EventOfType<'background-shell-matched'>,
  keyof { id: 0; seq: 0; threadId: 0; runId: 0; depth: 0; at: 0 }
>

export function matchedDraft(draft: EventDraft | undefined): MatchedDraft {
  if (draft?.type !== 'background-shell-matched') {
    throw new Error(`expected a background-shell-matched draft, got ${draft?.type ?? 'nothing'}`)
  }
  return draft
}

type StillRunningDraft = Omit<
  EventOfType<'background-shell-still-running'>,
  keyof { id: 0; seq: 0; threadId: 0; runId: 0; depth: 0; at: 0 }
>

export function stillRunningDraft(draft: EventDraft | undefined): StillRunningDraft {
  if (draft?.type !== 'background-shell-still-running') {
    throw new Error(
      `expected a background-shell-still-running draft, got ${draft?.type ?? 'nothing'}`,
    )
  }
  return draft
}

const SOCKET = process.env.ATLAS_DOCKER_SOCKET ?? DEFAULT_DOCKER_SOCKET
const DOCKER_PREFIX = 'atlas-dev-shells'
const dockerEngine = new DockerEngine({ socketPath: SOCKET })

export type ShellAdapter = {
  name: string
  available: boolean
  processes(args: { root: string }): ProcessPort
  sweep(args: { root: string }): Promise<void>
}

const dockerSandbox = (root: string): SandboxConfig => ({
  image: DEFAULT_SANDBOX_IMAGE,
  worktree: root,
  session: `shell-registry-${root}`,
  uid: process.getuid?.() ?? 501,
  gid: process.getgid?.() ?? 20,
  home: '/Users/operator',
  limits: { cpus: 1, memoryBytes: 512 * 1024 ** 2 },
  dockerSocket: SOCKET,
  labelPrefix: DOCKER_PREFIX,
})

export const localShellAdapter: ShellAdapter = {
  name: 'local',
  available: true,
  processes: () => new LocalProcessPort(),
  sweep: async () => {},
}

export const dockerShellAdapter: ShellAdapter = {
  name: 'docker',
  available: liveDockerOptedIn() && existsSync(SOCKET),
  processes: ({ root }) =>
    new DockerProcessPort({ engine: dockerEngine, sandbox: dockerSandbox(root) }),
  sweep: async ({ root }) => {
    const stale = await dockerEngine.listContainers({
      labels: { [worktreeLabel(DOCKER_PREFIX)]: root },
      all: true,
    })
    for (const container of stale) await dockerEngine.removeContainer({ id: container.id })
  },
}

export const shellAdapters: readonly ShellAdapter[] = [localShellAdapter, dockerShellAdapter]

const opened: { registry: ShellRegistryPort; root: string; adapter: ShellAdapter }[] = []

export async function closeRegistries(): Promise<void> {
  for (const entry of opened.splice(0)) {
    await entry.registry.closeAll()
    await entry.adapter.sweep({ root: entry.root })
    rmSync(entry.root, { recursive: true, force: true })
  }
}

const noHooks: HookChainSource = () => new HookChain({})

/**
 * The event log the registry appends endings to at occurrence. Stamps drafts the way the real log
 * does so specs can read back what a turn would read, and keeps the drafts for direct assertion.
 */
export class RecordingLog extends EventLogPort {
  readonly appended: EventDraft[] = []
  private readonly stored: Event[] = []
  private seq = 0

  async append(args: { threadId: ThreadId; drafts: readonly EventDraft[] }): Promise<Event[]> {
    this.appended.push(...args.drafts)
    this.seq += 1
    const runId = toRunId(`run-${this.seq}`)
    let eventSeq = 0
    const envelopes = args.drafts.map(() => {
      eventSeq += 1
      return {
        id: toEventId(`event-${this.seq}-${eventSeq}`),
        seq: eventSeq,
        threadId: args.threadId,
        runId,
        depth: 0,
        at: '2026-09-26T00:00:00.000Z',
      }
    })
    const stamped = stampDrafts({ drafts: [...args.drafts], envelopes })
    this.stored.push(...stamped)
    return stamped
  }

  async read(args: { threadId: ThreadId }): Promise<Event[]> {
    return this.stored.filter((event) => event.threadId === args.threadId)
  }

  async readOwn(args: { threadId: ThreadId }): Promise<Event[]> {
    return this.read(args)
  }

  async refresh(): Promise<void> {}
  async head(): Promise<number> {
    return this.seq
  }

  async replace(): Promise<Event[]> {
    return []
  }
}

export function openRegistry({
  adapter = localShellAdapter,
  hooks,
  log: givenLog,
}: {
  adapter?: ShellAdapter
  hooks?: HookChainSource | undefined
  /** Pass null for the log-less registry (bell-fallback wiring); omitted gets a fresh RecordingLog. */
  log?: RecordingLog | null | undefined
} = {}): {
  registry: BunShellRegistry
  clock: SteppableClock
  root: string
  log: RecordingLog | undefined
} {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-shells-')))
  const clock = new SteppableClock()
  const log = givenLog === null ? undefined : (givenLog ?? new RecordingLog())
  const registry = new BunShellRegistry(
    root,
    clock,
    hooks ?? noHooks,
    adapter.processes({ root }),
    undefined,
    log,
    log === undefined ? undefined : new RandomIds(),
  )
  opened.push({ registry, root, adapter })
  return { registry, clock, root, log }
}

/**
 * The ending is appended at occurrence, so "the shell settled" is not "the log has its ending":
 * hooks and the append run after the status flips, and a spec asserting on the log waits on this.
 */
export async function recorded({
  log,
  threadId = THREAD,
  count = 1,
}: {
  log: RecordingLog | undefined
  threadId?: ThreadId
  count?: number
}): Promise<void> {
  if (log === undefined) throw new Error('the registry was opened without a log')
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const events = await log.read({ threadId })
    if (events.filter((event) => event.type === 'background-shell-ended').length >= count) return
    await Bun.sleep(25)
  }
  throw new Error(`no background-shell-ended ever reached the log for ${threadId}`)
}

export const job = ({ command, threadId = THREAD }: { command: string; threadId?: ThreadId }) => ({
  threadId,
  description: 'Run a background job',
  command,
})

export async function settle({
  registry,
  shellId,
  threadId = THREAD,
}: {
  registry: ShellRegistryPort
  shellId: string
  threadId?: ThreadId
}): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const snapshot = registry.list({ threadId }).find((entry) => entry.shellId === shellId)
    if (snapshot !== undefined && snapshot.status !== EShellStatus.Running) return
    await Bun.sleep(25)
  }
  throw new Error(`background shell ${shellId} never left running`)
}

export async function printed({
  registry,
  shellId,
  text,
  threadId = THREAD,
}: {
  registry: ShellRegistryPort
  shellId: string
  text: string
  threadId?: ThreadId
}): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (registry.peek({ shellId, characters: 2000, threadId })?.includes(text)) return
    await Bun.sleep(25)
  }
  throw new Error(`background shell ${shellId} never printed ${JSON.stringify(text)}`)
}

/**
 * A kill flips the status synchronously but the ending is announced when the process is reaped, so
 * waiting on the status is not waiting on the notice.
 */
export async function announced({
  registry,
  threadId = THREAD,
}: {
  registry: ShellRegistryPort
  threadId?: ThreadId
}): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (registry.pendingNotices({ threadId }).length > 0) return
    await Bun.sleep(25)
  }
  throw new Error('no background shell ending was ever announced')
}

export const awaitingInputOf = async ({
  registry,
  shellId,
}: {
  registry: ShellRegistryPort
  shellId: string
}): Promise<boolean> => {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const snapshot = registry.list({ threadId: THREAD }).find((entry) => entry.shellId === shellId)
    if (snapshot?.awaitingInput === true) return true
    await Bun.sleep(25)
  }
  return false
}
