import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { LogPort, type LogEntry } from '@dltech/atlas-observability'
import type { Lease } from '@dltech/atlas-core'
import type { ControlPlane } from '@dltech/atlas-control'
import type { HostBus } from '@dltech/atlas-host'
import type { ScriptedModelStep } from '@dltech/atlas-agent/testing'
import { ScriptedModel } from '@dltech/atlas-agent/testing'
import { RandomIds } from '../runtime/random-ids'
import { SessionHolder, systemTimers } from '@dltech/atlas-host'

import type { LocalSandboxProvider } from '../testing/local-sandbox-provider'
import { createSessionRuntimeFactory } from '../runtime/session-runtime-factory'
import type { AgentHostApi } from '../config/agent-host-api'

process.env.ATLAS_HOME = mkdtempSync(join(tmpdir(), 'atlas-agent-host-e2e-'))
const E2E_WORKSPACE = mkdtempSync(join(tmpdir(), 'atlas-agent-host-e2e-workspace-'))

export const E2E_SECRET = 'e2e-daemon-secret'

export type InMemoryBus = HostBus & {
  reset(): void
  wake(sessionId: string): Promise<void>
  wakes: string[]
  lives: { sessionId: string; frame: unknown }[]
}

export const makeInMemoryBus = (): InMemoryBus => {
  const listeners = new Set<(sessionId: string) => void>()
  const wakes: string[] = []
  const lives: { sessionId: string; frame: unknown }[] = []
  return {
    onWake(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    onResync() {
      return () => {}
    },
    async wake(sessionId) {
      wakes.push(sessionId)
      for (const listener of [...listeners]) listener(sessionId)
    },
    live({ sessionId, frame }) {
      lives.push({ sessionId, frame })
    },
    reset() {
      wakes.length = 0
      lives.length = 0
    },
    wakes,
    lives,
  }
}

export const apiFor = (setupScript = ''): AgentHostApi => ({
  config: async () => ({
    userId: 'user-1',
    projectId: 'proj-1',
    model: { configured: false, gap: 'scripted model in test' },
    vercel: { configured: true, token: '', teamId: '', projectId: '' },
    workspace: { remoteUrl: null, baseBranch: null, additionalRepos: [], setupScript },
    config: {
      settings: {},
      secrets: [],
      harnessSecrets: [],
      mcpServers: [],
      fileMounts: [],
      provenance: {},
    },
    revision: 'rev-1',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }),
  modelAccessToken: async () => {
    throw new Error('unused')
  },
  githubToken: async () => ({ token: null }),
})

export class CollectingLog extends LogPort {
  readonly entries: LogEntry[] = []
  record(entry: LogEntry): void {
    this.entries.push(entry)
  }

  dump(name: string): string {
    const lines = this.entries.map(
      (entry) => `${entry.severity} ${entry.source} ${entry.message} ${entry.error ?? ''}`,
    )
    return `${name}: ${lines.join(' | ') || 'empty'}`
  }
}

export const makeHolder = (args: {
  holderId: string
  plane: ControlPlane
  bus: InMemoryBus
  sandbox: LocalSandboxProvider
  scripts: Record<string, ScriptedModelStep[]>
  log?: CollectingLog | undefined
  setupScript?: string | undefined
  launchDirectory?: string | undefined
}): SessionHolder => {
  const timers = { now: () => Date.now(), ...systemTimers }
  return new SessionHolder({
    holderId: args.holderId,
    plane: args.plane,
    bus: args.bus,
    timers,
    runtimes: createSessionRuntimeFactory({
      api: apiFor(args.setupScript),
      sandbox: args.sandbox,
      daemonSecret: E2E_SECRET,
      timers,
      modelFor: ({ sessionId }) => new ScriptedModel(args.scripts[sessionId] ?? []),
      launchDirectory: args.launchDirectory ?? E2E_WORKSPACE,
    }),
    ids: new RandomIds(),
    maxSessions: 25,
    ttlMs: 30_000,
    renewEveryMs: 5_000,
    fenceMarginMs: 5_000,
    idleMinutes: 30,
    ...(args.log === undefined ? {} : { log: args.log }),
  })
}

export type ReadEvent = { seq: number; type: string; event: unknown }

export const readAllEvents = async (args: {
  plane: ControlPlane
  threadId: string
}): Promise<ReadEvent[]> => {
  const page = await args.plane.readEvents({
    threadId: args.threadId,
    afterSeq: 0,
    limit: 1_000,
    visible: true,
  })
  return page.events.map((row) => ({ seq: row.seq, type: row.type, event: row }))
}

export const waitForSeq = async (args: {
  plane: ControlPlane
  threadId: string
  want: (events: readonly ReadEvent[]) => boolean
  timeoutMs?: number | undefined
}): Promise<ReadEvent[]> => {
  const deadline = Date.now() + (args.timeoutMs ?? 30_000)
  let last: ReadEvent[] = []
  while (Date.now() < deadline) {
    last = await readAllEvents({ plane: args.plane, threadId: args.threadId })
    if (args.want(last)) return last
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(
    `timed out; last events: ${last.map((row) => `${row.seq}:${row.type}`).join(', ')}`,
  )
}

export const isDoneResult = (row: ReadEvent): boolean => {
  if (row.type !== 'tool-result') return false
  const result = row.event as { output?: unknown; interrupted?: boolean }
  if (result.interrupted === true) return false
  if (typeof result.output !== 'object' || result.output === null) return false
  const output = result.output as { stdout?: unknown; exitCode?: unknown }
  return (
    output.exitCode === 0 && typeof output.stdout === 'string' && output.stdout.includes('done')
  )
}

export const waitForLease = async (args: {
  plane: ControlPlane
  sessionId: string
  holderId: string
  timeoutMs?: number | undefined
}): Promise<Lease> => {
  const deadline = Date.now() + (args.timeoutMs ?? 30_000)
  for (;;) {
    const current = await args.plane.currentLease({ sessionId: args.sessionId })
    if (current.live && current.lease.holderId === args.holderId) return current.lease
    if (Date.now() > deadline) {
      throw new Error(
        `timed out waiting for ${args.holderId} to hold ${args.sessionId}: ${JSON.stringify(current)}`,
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}
