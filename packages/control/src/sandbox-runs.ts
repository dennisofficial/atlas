import {
  ESandboxCostProvider,
  ESandboxCostSource,
  meteredRunSharesOf,
  roundUsd,
  sandboxComputeOf,
  sandboxRunCostUsd,
  type SandboxCompute,
  type SandboxRunRow,
} from '@dltech/atlas-core'

export type OpenSandboxRunParams = {
  sessionId: string
  userId?: string | undefined
  provider: ESandboxCostProvider
  sandboxInstanceId?: string | null | undefined
  vcpus: number
  memoryGb: number
  diskGb: number
  at: number
  cpuBaselineMs?: number | undefined
}

export type CloseSandboxRunParams = {
  sessionId: string
  at: number
  cpuCumulativeMs?: number | undefined
  awakeMs?: number | undefined
}

export type SandboxRunCloseRow = {
  id: string
  endedAt: number
  costUsd: number
  costSource: ESandboxCostSource
  activeCpuMs: number | null
  awakeMs: number | null
}

export type MeterSandboxRunParams = {
  id: string
  costUsd: number
  awakeMs: number
}

export type MeterSandboxRunsParams = {
  sandboxInstanceId: string
  computeMicros: number
  from: number
  to: number
}

export type SandboxRunStore = {
  openRunOf(sessionId: string): Promise<SandboxRunRow | undefined>
  insertRun(params: OpenSandboxRunParams & { id: string }): Promise<void>
  closeRun(row: SandboxRunCloseRow): Promise<void>
  meterRun(params: MeterSandboxRunParams): Promise<void>
  runsForSession(sessionId: string): Promise<SandboxRunRow[]>
  runsForInstance(sandboxInstanceId: string): Promise<SandboxRunRow[]>
}

export type SandboxRunRecorder = {
  open(params: OpenSandboxRunParams): Promise<void>
  close(params: CloseSandboxRunParams): Promise<void>
  meter(params: MeterSandboxRunsParams): Promise<number>
  compute(params: {
    sessionId: string
    at: number
    cumulativeCpuMs?: number | undefined
  }): Promise<SandboxCompute>
}

const activeCpuMsOf = (args: {
  open: SandboxRunRow
  cumulativeMs: number | undefined
}): number | null => {
  if (args.open.provider !== ESandboxCostProvider.Vercel) return args.open.activeCpuMs
  if (args.cumulativeMs === undefined) return args.open.activeCpuMs
  const baseline = args.open.cpuBaselineMs ?? 0
  return Math.max(0, Math.round(args.cumulativeMs - baseline))
}

export const sandboxRunRecorderOf = (args: {
  store: SandboxRunStore
  ids: () => string
  now: () => number
}): SandboxRunRecorder => ({
  open: async (params) => {
    const open = await args.store.openRunOf(params.sessionId)
    if (open !== undefined) return
    await args.store.insertRun({ ...params, id: args.ids() })
  },
  close: async (params) => {
    const open = await args.store.openRunOf(params.sessionId)
    if (open === undefined) return
    const activeCpuMs = activeCpuMsOf({ open, cumulativeMs: params.cpuCumulativeMs })
    const awakeMs =
      params.awakeMs ??
      (open.provider === ESandboxCostProvider.Agent37 ? params.at - open.startedAt : open.awakeMs)
    const costUsd = sandboxRunCostUsd({
      provider: open.provider,
      vcpus: open.vcpus,
      memoryGb: open.memoryGb,
      diskGb: open.diskGb,
      startedAt: open.startedAt,
      endedAt: params.at,
      ...(activeCpuMs === null ? {} : { activeCpuMs }),
      ...(awakeMs === null ? {} : { awakeMs: Math.round(awakeMs) }),
    })
    await args.store.closeRun({
      id: open.id,
      endedAt: params.at,
      costUsd,
      costSource: activeCpuMs === null ? ESandboxCostSource.Estimate : ESandboxCostSource.Measured,
      activeCpuMs,
      awakeMs: awakeMs === null ? null : Math.round(awakeMs),
    })
  },
  meter: async (params) => {
    const rows = await args.store.runsForInstance(params.sandboxInstanceId)
    const shares = meteredRunSharesOf({
      computeMicros: params.computeMicros,
      runs: rows,
      windowStart: params.from,
      windowEnd: params.to,
    })
    const byId = new Map(rows.map((row) => [row.id, row]))
    for (const share of shares) {
      const row = byId.get(share.id)
      await args.store.meterRun({
        id: share.id,
        costUsd: share.costUsd,
        awakeMs: Math.max(
          0,
          Math.round((row?.endedAt ?? params.to) - (row?.startedAt ?? params.to)),
        ),
      })
    }
    return shares.length
  },
  compute: async (params) =>
    sumCompute({
      rows: await args.store.runsForSession(params.sessionId),
      now: params.at,
      ...(params.cumulativeCpuMs === undefined ? {} : { cumulativeCpuMs: params.cumulativeCpuMs }),
    }),
})

export const sumCompute = (args: {
  rows: readonly SandboxRunRow[]
  now: number
  cumulativeCpuMs?: number | undefined
}): SandboxCompute => {
  const compute = sandboxComputeOf(args)
  if (compute.costUsd === null) return compute
  return { ...compute, costUsd: roundUsd(compute.costUsd) }
}
