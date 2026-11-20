import type { Db } from '@dltech/atlas-db'
import { ESandboxCostProvider, ESandboxCostSource, type SandboxRunRow } from '@dltech/atlas-core'

import type {
  MeterSandboxRunParams,
  OpenSandboxRunParams,
  SandboxRunCloseRow,
  SandboxRunStore,
} from '../sandbox-runs'

type RunRow = {
  id: string
  sessionId: string
  userId: string
  provider: string
  sandboxInstanceId: string | null
  vcpus: number
  memoryGb: number
  diskGb: number
  startedAt: Date
  endedAt: Date | null
  activeCpuMs: number | null
  cpuBaselineMs: number | null
  awakeMs: number | null
  costUsd: number | null
  costSource: string | null
}

const providerOf = (value: string): ESandboxCostProvider =>
  value === ESandboxCostProvider.Agent37
    ? ESandboxCostProvider.Agent37
    : ESandboxCostProvider.Vercel

const costSourceOf = (value: string | null): ESandboxCostSource | null => {
  if (value === ESandboxCostSource.Estimate) return ESandboxCostSource.Estimate
  if (value === ESandboxCostSource.Measured) return ESandboxCostSource.Measured
  if (value === ESandboxCostSource.Metered) return ESandboxCostSource.Metered
  return null
}

const rowOf = (row: RunRow): SandboxRunRow => ({
  id: row.id,
  sessionId: row.sessionId,
  userId: row.userId,
  provider: providerOf(row.provider),
  sandboxInstanceId: row.sandboxInstanceId,
  vcpus: row.vcpus,
  memoryGb: row.memoryGb,
  diskGb: row.diskGb,
  startedAt: row.startedAt.getTime(),
  endedAt: row.endedAt?.getTime() ?? null,
  activeCpuMs: row.activeCpuMs,
  cpuBaselineMs: row.cpuBaselineMs,
  awakeMs: row.awakeMs,
  costUsd: row.costUsd,
  costSource: costSourceOf(row.costSource),
})

export class PostgresSandboxRunStore implements SandboxRunStore {
  constructor(private readonly db: Db) {}

  private get runs() {
    return this.db.orm.v2.V2SandboxRun
  }

  private async rowsForSession(sessionId: string): Promise<RunRow[]> {
    return (await this.runs
      .where({ sessionId })
      .orderBy((run) => run.startedAt.asc())
      .all()) as RunRow[]
  }

  async openRunOf(sessionId: string): Promise<SandboxRunRow | undefined> {
    const rows = await this.rowsForSession(sessionId)
    const open = rows.find((row) => row.endedAt === null)
    return open === undefined ? undefined : rowOf(open)
  }

  async insertRun(params: OpenSandboxRunParams & { id: string }): Promise<void> {
    const session =
      params.userId === undefined
        ? await this.db.orm.v2.V2Session.first({ id: params.sessionId })
        : undefined
    const userId = params.userId ?? session?.userId
    if (userId === undefined) return
    await this.runs.create({
      id: params.id,
      sessionId: params.sessionId,
      userId,
      provider: params.provider,
      sandboxInstanceId: params.sandboxInstanceId ?? null,
      vcpus: params.vcpus,
      memoryGb: params.memoryGb,
      diskGb: params.diskGb,
      startedAt: new Date(params.at),
      endedAt: null,
      activeCpuMs: null,
      cpuBaselineMs: params.cpuBaselineMs ?? null,
      awakeMs: null,
      costUsd: null,
      costSource: null,
    })
  }

  async closeRun(row: SandboxRunCloseRow): Promise<void> {
    await this.runs.where({ id: row.id }).update({
      endedAt: new Date(row.endedAt),
      costUsd: row.costUsd,
      costSource: row.costSource,
      activeCpuMs: row.activeCpuMs,
      awakeMs: row.awakeMs,
    })
  }

  async meterRun(params: MeterSandboxRunParams): Promise<void> {
    await this.runs.where({ id: params.id }).update({
      costUsd: params.costUsd,
      costSource: ESandboxCostSource.Metered,
      awakeMs: params.awakeMs,
    })
  }

  async runsForInstance(sandboxInstanceId: string): Promise<SandboxRunRow[]> {
    const rows = (await this.runs
      .where({ sandboxInstanceId })
      .orderBy((run) => run.startedAt.asc())
      .all()) as RunRow[]
    return rows.map(rowOf)
  }

  async runsForSession(sessionId: string): Promise<SandboxRunRow[]> {
    return (await this.rowsForSession(sessionId)).map(rowOf)
  }
}
