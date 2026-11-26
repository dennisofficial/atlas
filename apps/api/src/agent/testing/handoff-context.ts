import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  EWorkspaceStep,
  workspaceStepsOf,
  type RecordEvent,
  type WorkspaceStepStatus,
} from '@dltech/atlas-core'

import { makeFifo, releaseFifo, waitForFile } from '../__tests__/faults/fault-support'
import type { FaultRig, ReadEvent, RigDaemon } from './fault-rig'

const readAll = async (args: {
  plane: FaultRig['plane']
  threadId: string
  visible: boolean
}): Promise<ReadEvent[]> => {
  const page = await args.plane.readEvents({
    threadId: args.threadId,
    afterSeq: 0,
    limit: 1_000,
    visible: args.visible,
  })
  return page.events.map((row) => ({ seq: row.seq, type: row.type, event: row }))
}

/**
 * What a scenario gets to work with. Files it creates through `path` and `gate` live in the
 * workspace both hosts share, so they survive a handoff the way a file in the pod does.
 */
export type HandoffContext = {
  rig: FaultRig
  sessionId: string
  threadId: string
  daemon: RigDaemon
  workspace: string
  /** paths the scenario created, by name, so `runs` and the assertions can find them again */
  paths: Record<string, string>
  path(name: string): string
  /** a fifo in the workspace: the work blocks reading it until something writes to it */
  gate(name: string): string
  waitFor(name: string, timeoutMs?: number): Promise<void>
  release(name: string): Promise<void>
  /** how many lines the file called `name` has, 0 when it does not exist */
  runCount(name: string): number
  /** the events a later reader sees (tool calls, assistant text, ...) */
  events(): Promise<ReadEvent[]>
  /** every event, including the record-only ones such as `workspace-step` */
  record(): Promise<ReadEvent[]>
  steps(): Promise<Partial<Record<EWorkspaceStep, WorkspaceStepStatus>>>
}

export const contextFor = (args: {
  rig: FaultRig
  sessionId: string
  threadId: string
  daemon: RigDaemon
  workspace: string
}): HandoffContext => {
  const paths: Record<string, string> = {}
  const ctx: HandoffContext = {
    rig: args.rig,
    sessionId: args.sessionId,
    threadId: args.threadId,
    daemon: args.daemon,
    workspace: args.workspace,
    paths,
    path: (name) => {
      const path = join(args.workspace, name)
      paths[name] = path
      return path
    },
    gate: (name) => {
      const path = ctx.path(name)
      makeFifo({ path })
      return path
    },
    waitFor: (name, timeoutMs) => {
      const path = paths[name]
      if (path === undefined) throw new Error(`the scenario never created ${name}`)
      return waitForFile({ path, ...(timeoutMs === undefined ? {} : { timeoutMs }) })
    },
    release: (name) => {
      const path = paths[name]
      if (path === undefined) throw new Error(`the scenario never created ${name}`)
      return releaseFifo({ path })
    },
    runCount: (name) => {
      const path = paths[name]
      if (path === undefined || !existsSync(path)) return 0
      const text = readFileSync(path, 'utf8').trim()
      return text === '' ? 0 : text.split('\n').length
    },
    events: () => readAll({ plane: args.rig.plane, threadId: args.threadId, visible: true }),
    record: () => readAll({ plane: args.rig.plane, threadId: args.threadId, visible: false }),
    steps: async () =>
      workspaceStepsOf((await ctx.record()).map((row) => row.event as RecordEvent)),
  }
  return ctx
}

export const freshWorkspaceOf = (args: { root: string; slug: string }): string => {
  const workspace = join(args.root, args.slug, 'workspace')
  mkdirSync(workspace, { recursive: true })
  return workspace
}
