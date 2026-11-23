import '@dltech/atlas-plugin-sdk/testing'

import { toEventId, toRunId, toThreadId, type V2Event } from '@dltech/atlas-core'
import type { TracePort } from '@dltech/atlas-observability'
import {
  ECloudSetting,
  EMPTY_CREW,
  EMPTY_CLASSIFIER,
  EMPTY_POD_RESOURCES,
  EMPTY_SESSIONS,
  EMPTY_WORKTREES,
  type PluginPodContext,
  type PodResource,
} from '@dltech/atlas-plugin-sdk'
import { podControlStub } from '@dltech/atlas-plugin-sdk/testing'
import { ECallFailure, ECallStatus, type CallOp, type CallResult } from '@dltech/atlas-protocol'
import { z } from 'zod'

import { pluginResourcesClosedHook, pluginResourcesHook } from '../plugin-resources'
import { ResourceSync } from '../plugin-resource-sync'

export const THREAD = toThreadId('t1')
export const DIRECTORY = '/work'

type DaemonEventFrame = Parameters<Parameters<PluginPodContext['onDaemonEvent']>[0]>[0]

export const versionsAt = (version: string): Record<ECloudSetting, string> => ({
  [ECloudSetting.McpServers]: version,
  [ECloudSetting.Skills]: version,
  [ECloudSetting.PersonalInstructions]: version,
})

export type Daemon = {
  readonly seqs: Map<string, number>
  instance(): string
  readVersions(): Promise<Record<ECloudSetting, string>>
  versionReads(): number
  setInstance(instance: string): void
  setVersions(versions: Record<ECloudSetting, string>): void
  failVersions(failure: Error | undefined): void
}

export const daemonOf = (): Daemon => {
  const seqs = new Map<string, number>()
  let instance = 'instance-1'
  let versions = versionsAt('v1')
  let failure: Error | undefined
  let reads = 0
  return {
    seqs,
    instance: () => instance,
    readVersions: async () => {
      reads += 1
      if (failure !== undefined) throw failure
      return versions
    },
    versionReads: () => reads,
    setInstance: (next) => {
      instance = next
      seqs.clear()
    },
    setVersions: (next) => {
      versions = next
    },
    failVersions: (next) => {
      failure = next
    },
  }
}

export type Rig = {
  ctx: PluginPodContext
  events: V2Event[]
  calls: CallOp[]
  logs: string[]
  daemon: Daemon
  sync: ResourceSync
  run(directory?: string): Promise<void>
  closed(): Promise<void>
  changed(watchId: string): void
  reconnect(restart: boolean): void
  settled(): Promise<void>
}

const stamp = (draft: object, seq: number): V2Event =>
  ({
    ...draft,
    id: toEventId(`t:${seq}`),
    seq,
    threadId: THREAD,
    runId: toRunId('r'),
    depth: 0,
    at: '2026-11-20T12:00:00.000Z',
    epoch: 1,
    prevHash: 'a'.repeat(64),
  }) as V2Event

export const snapshotEventOf = (args: {
  resource: string
  fingerprint: string
  value: unknown
}): V2Event => stamp({ type: 'resource-loaded', ...args }, 1)

export const rig = (args: {
  resources: readonly PodResource<unknown>[]
  daemon?: Daemon | undefined
  shared?: (() => readonly V2Event[]) | undefined
  trace?: TracePort | undefined
  beforeCall?: ((op: CallOp) => Promise<void>) | undefined
}): Rig => {
  const daemon = args.daemon ?? daemonOf()
  const events: V2Event[] = []
  const calls: CallOp[] = []
  const logs: string[] = []
  const daemonListeners = new Set<(frame: DaemonEventFrame) => void>()
  const readyListeners = new Set<(hello: { restart: boolean }) => void>()
  let directory = DIRECTORY

  const ctx: PluginPodContext = {
    sessionId: 'session-1',
    control: { ...podControlStub, settingsVersions: () => daemon.readVersions() },
    crew: EMPTY_CREW,
    classifier: EMPTY_CLASSIFIER,
    sessions: EMPTY_SESSIONS,
    worktrees: EMPTY_WORKTREES,
    resources: EMPTY_POD_RESOURCES,
    events: () => events,
    append: async (drafts) => {
      for (const draft of drafts) events.push(stamp(draft, events.length + 1))
    },
    notify: async () => undefined,
    live: () => undefined,
    onDaemonEvent: (listener) => {
      daemonListeners.add(listener)
      return () => {
        daemonListeners.delete(listener)
      }
    },
    log: (message) => logs.push(message),
    call: async (op) => {
      await args.beforeCall?.(op)
      calls.push(op)
      if (op.op === 'watch.status') {
        return {
          status: ECallStatus.Ok,
          op: 'watch.status',
          value: {
            instance: daemon.instance(),
            watches: op.watchIds.flatMap((watchId) => {
              const seq = daemon.seqs.get(watchId)
              return seq === undefined ? [] : [{ watchId, seq }]
            }),
          },
        } as CallResult
      }
      if (op.op === 'watch.start') {
        daemon.seqs.set(op.watchId, 0)
        return { status: ECallStatus.Ok, op: 'watch.start', value: [...op.roots] } as CallResult
      }
      return {
        status: ECallStatus.Failed,
        op: op.op,
        error: { code: ECallFailure.NotFound, message: `no ${op.op}` },
      } as CallResult
    },
  }

  const sync = new ResourceSync({
    ctx,
    resources: args.resources,
    directory: () => directory,
    trace: args.trace,
    shared: args.shared,
    reconnect: (listener) => {
      readyListeners.add(listener)
      return () => {
        readyListeners.delete(listener)
      }
    },
  })
  const hook = pluginResourcesHook({ sync })
  const closing = pluginResourcesClosedHook({ sync })
  return {
    ctx,
    events,
    calls,
    logs,
    daemon,
    sync,
    run: async (next = DIRECTORY) => {
      directory = next
      sync.start()
      await hook.run({ threadId: THREAD, projectDirectory: next })
      await sync.settled()
    },
    closed: async () => {
      await closing.run({ threadId: THREAD })
      await sync.settled()
    },
    changed: (watchId) => {
      const frame = {
        kind: 'event' as const,
        event: { type: 'watch.changed' as const, watchId, paths: [`${directory}/.agents/skills`] },
      } as DaemonEventFrame
      for (const listener of daemonListeners) listener(frame)
    },
    reconnect: (restart) => {
      for (const listener of readyListeners) listener({ restart })
    },
    settled: () => sync.settled(),
  }
}

export const agentsRootOf = (directory: string): string => `${directory}/.agents`

export const stringResource = (args: {
  name: string
  loads: string[]
  value: () => string
  watch?: boolean
  cloud?: readonly ECloudSetting[] | undefined
  background?: boolean | undefined
  pending?: Promise<string> | undefined
  announce?: ((value: string) => readonly { type: 'probe-observed'; label: string }[]) | undefined
  stale?: ((value: string) => boolean) | undefined
}): PodResource<string> => ({
  name: args.name,
  schema: z.string(),
  ...(args.cloud === undefined ? {} : { cloud: args.cloud }),
  ...(args.background === undefined ? {} : { background: args.background }),
  ...(args.announce === undefined ? {} : { announce: args.announce }),
  ...(args.stale === undefined ? {} : { stale: args.stale }),
  ...(args.watch === true
    ? { watch: (directory: string) => ({ roots: [agentsRootOf(directory)] }) }
    : {}),
  load: async () => {
    args.loads.push(args.name)
    return await (args.pending ?? Promise.resolve(args.value()))
  },
})

export const skillsOf = (
  loads: string[],
  overrides: Partial<Parameters<typeof stringResource>[0]> = {},
): PodResource<string> =>
  stringResource({ name: 'skills', loads, value: () => 'one', watch: true, ...overrides })
