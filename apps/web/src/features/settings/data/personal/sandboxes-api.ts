import { z } from 'zod'

import { cloudJson, cloudSend, EHttpMethod } from '@/lib/cloud-api'

import type { SandboxRow } from '../../fixtures/settings-usage-rows'
import { relativeTime } from './relative-time'

export enum ESandboxState {
  Running = 'running',
  Parked = 'parked',
  Resuming = 'resuming',
}

const NOT_AVAILABLE = '—'

const sandboxSchema = z.object({
  threadId: z.string(),
  name: z.string(),
  state: z.enum(ESandboxState),
  lastActivityAt: z.string(),
})

export type SandboxEntry = z.infer<typeof sandboxSchema>

export function fetchSandboxes(): Promise<SandboxEntry[]> {
  return cloudJson({ method: EHttpMethod.Get, path: '/v1/sandboxes', schema: z.array(sandboxSchema) })
}

export function destroySandbox(threadId: string): Promise<void> {
  return cloudSend({
    method: EHttpMethod.Post,
    path: `/v1/sandboxes/${encodeURIComponent(threadId)}/destroy`,
  })
}

export function toSandboxRow(args: { entry: SandboxEntry; now?: number }): SandboxRow {
  const since = relativeTime({
    from: args.entry.lastActivityAt,
    ...(args.now === undefined ? {} : { now: args.now }),
  })
  const base = {
    id: args.entry.threadId,
    title: args.entry.name,
    repo: NOT_AVAILABLE,
    size: NOT_AVAILABLE,
    last24h: NOT_AVAILABLE,
    cost: NOT_AVAILABLE,
  }
  return args.entry.state === ESandboxState.Parked
    ? { ...base, pausedAgo: since }
    : { ...base, runningFor: since }
}

export function splitSandboxes(args: { entries: SandboxEntry[]; now?: number }): {
  running: SandboxRow[]
  paused: SandboxRow[]
} {
  const rows = args.entries.map((entry) => ({ entry, row: toSandboxRow({ entry, now: args.now }) }))
  return {
    running: rows.filter(({ entry }) => entry.state !== ESandboxState.Parked).map(({ row }) => row),
    paused: rows.filter(({ entry }) => entry.state === ESandboxState.Parked).map(({ row }) => row),
  }
}
