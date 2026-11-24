import { randomUUID } from 'node:crypto'

import { ESandboxCostProvider, type SandboxCompute } from '@dltech/atlas-core'
import {
  PostgresSandboxRunStore,
  postQuietEndingsOf,
  sandboxRunRecorderOf,
} from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import { ESandboxProvider } from '@dltech/atlas-protocol'
import { db } from '@dltech/atlas-db'

import { agent37ShapeOfVcpus } from './agent37/agent37-resize'
import type { SandboxProvider, SandboxTarget } from './sandbox-provider'

export const VERCEL_MEMORY_GB_PER_VCPU = 2

const sandboxRunStore = new PostgresSandboxRunStore(db)

export const sandboxRuns = sandboxRunRecorderOf({
  store: sandboxRunStore,
  ids: () => randomUUID(),
  now: () => Date.now(),
})

const quietEndingStore = new PostgresControlStore(db)

const postQuietEndings = async (sessionId: string): Promise<void> => {
  try {
    const session = await db.orm.v2.V2Session.first({ id: sessionId })
    if (session === undefined || session === null) return
    await postQuietEndingsOf({
      store: quietEndingStore,
      sessionId,
      mainThreadId: session.mainThreadId,
      at: new Date().toISOString(),
    })
  } catch {
    return
  }
}

export const costProviderOf = (provider: ESandboxProvider): ESandboxCostProvider =>
  provider === ESandboxProvider.Agent37 ? ESandboxCostProvider.Agent37 : ESandboxCostProvider.Vercel

export const sandboxPodSizeOf = (args: {
  provider: ESandboxCostProvider
  vcpus: number
  diskGb?: number | undefined
}): { vcpus: number; memoryGb: number; diskGb: number } => {
  if (args.provider === ESandboxCostProvider.Agent37) {
    const shape = agent37ShapeOfVcpus(args.vcpus)
    return { vcpus: shape.cpu, memoryGb: shape.memory, diskGb: args.diskGb ?? 0 }
  }
  return {
    vcpus: args.vcpus,
    memoryGb: VERCEL_MEMORY_GB_PER_VCPU * args.vcpus,
    diskGb: 0,
  }
}

const instanceIdOf = async (args: {
  sandbox: SandboxProvider
  target: SandboxTarget
}): Promise<string | undefined> => {
  try {
    return await args.sandbox.instanceIdOf({ target: args.target })
  } catch {
    return undefined
  }
}

const diskGbOf = (sandbox: SandboxProvider): number | undefined => {
  try {
    return sandbox.podDiskGb()
  } catch {
    return undefined
  }
}

export const sandboxCumulativeCpuMsOf = async (args: {
  sandbox: SandboxProvider
  target: SandboxTarget
}): Promise<number | undefined> => {
  try {
    return await args.sandbox.activeCpuMs({ target: args.target })
  } catch {
    return undefined
  }
}

export const recordSandboxRunOpen = async (args: {
  sessionId: string
  provider: ESandboxProvider
  vcpus: number
  sandbox: SandboxProvider
  target: SandboxTarget
  diskGb?: number | undefined
}): Promise<void> => {
  const provider = costProviderOf(args.provider)
  const size = sandboxPodSizeOf({
    provider,
    vcpus: args.vcpus,
    diskGb: args.diskGb ?? diskGbOf(args.sandbox),
  })
  const [baseline, sandboxInstanceId] = await Promise.all([
    provider === ESandboxCostProvider.Vercel
      ? sandboxCumulativeCpuMsOf({ sandbox: args.sandbox, target: args.target })
      : Promise.resolve(undefined),
    provider === ESandboxCostProvider.Agent37
      ? instanceIdOf({ sandbox: args.sandbox, target: args.target })
      : Promise.resolve(undefined),
  ])
  try {
    await sandboxRuns.open({
      sessionId: args.sessionId,
      provider,
      ...size,
      at: Date.now(),
      ...(baseline === undefined ? {} : { cpuBaselineMs: Math.round(baseline) }),
      ...(sandboxInstanceId === undefined ? {} : { sandboxInstanceId }),
    })
  } catch {
    return
  }
}

export const recordSandboxRunClose = async (args: {
  sessionId: string
  cpuCumulativeMs?: number | undefined
  at?: number | undefined
  sandboxStopped?: boolean | undefined
}): Promise<void> => {
  try {
    await sandboxRuns.close({
      sessionId: args.sessionId,
      at: args.at ?? Date.now(),
      ...(args.cpuCumulativeMs === undefined ? {} : { cpuCumulativeMs: args.cpuCumulativeMs }),
    })
  } catch {
    return
  }
  if (args.sandboxStopped !== false) await postQuietEndings(args.sessionId)
}

export const recordSandboxRunCloseForInstance = async (args: {
  sandboxInstanceId: string
  at: number
}): Promise<void> => {
  const session = await db.orm.v2.V2Session.first({ sandboxInstanceId: args.sandboxInstanceId })
  if (session === undefined || session === null) return
  try {
    await sandboxRuns.close({ sessionId: session.id, at: args.at })
  } catch {
    return
  }
  await postQuietEndings(session.id)
}

export const recordSandboxRunReopenForInstance = async (args: {
  sandboxInstanceId: string
  at: number
}): Promise<void> => {
  const session = await db.orm.v2.V2Session.first({ sandboxInstanceId: args.sandboxInstanceId })
  if (session === undefined || session === null) return
  try {
    if ((await sandboxRunStore.openRunOf(session.id)) !== undefined) return
    const latest = (await sandboxRunStore.runsForInstance(args.sandboxInstanceId)).at(-1)
    if (latest === undefined) return
    await sandboxRuns.open({
      sessionId: session.id,
      provider: latest.provider,
      vcpus: latest.vcpus,
      memoryGb: latest.memoryGb,
      diskGb: latest.diskGb,
      sandboxInstanceId: latest.sandboxInstanceId,
      at: args.at,
    })
  } catch {
    return
  }
}

export const recordSandboxRunMeter = async (args: {
  sandboxInstanceId: string
  computeMicros: number
  from: number
  to: number
}): Promise<number> => {
  try {
    return await sandboxRuns.meter(args)
  } catch {
    return 0
  }
}

export const sandboxComputeFor = async (args: {
  sessionId: string
  at?: number | undefined
  cumulativeCpuMs?: number | undefined
}): Promise<SandboxCompute> => {
  try {
    return await sandboxRuns.compute({
      sessionId: args.sessionId,
      at: args.at ?? Date.now(),
      ...(args.cumulativeCpuMs === undefined ? {} : { cumulativeCpuMs: args.cumulativeCpuMs }),
    })
  } catch {
    return { costUsd: null, running: false, tick: null }
  }
}
