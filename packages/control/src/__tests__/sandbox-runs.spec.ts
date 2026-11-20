import { describe, expect, test } from 'bun:test'

import { ESandboxCostProvider, ESandboxCostSource, type SandboxRunRow } from '@dltech/atlas-core'

import {
  sandboxRunRecorderOf,
  type MeterSandboxRunParams,
  type OpenSandboxRunParams,
  type SandboxRunCloseRow,
  type SandboxRunStore,
} from '../sandbox-runs'

const HOUR = 3_600_000

const memoryStoreOf = (): SandboxRunStore & { rows: SandboxRunRow[] } => {
  const rows: SandboxRunRow[] = []
  return {
    rows,
    openRunOf: async (sessionId) =>
      rows.find((row) => row.sessionId === sessionId && row.endedAt === null),
    insertRun: async (params: OpenSandboxRunParams & { id: string }) => {
      rows.push({
        id: params.id,
        sessionId: params.sessionId,
        userId: params.userId ?? 'usr-1',
        provider: params.provider,
        sandboxInstanceId: params.sandboxInstanceId ?? null,
        vcpus: params.vcpus,
        memoryGb: params.memoryGb,
        diskGb: params.diskGb,
        startedAt: params.at,
        endedAt: null,
        activeCpuMs: null,
        cpuBaselineMs: params.cpuBaselineMs ?? null,
        awakeMs: null,
        costUsd: null,
        costSource: null,
      })
    },
    closeRun: async (row: SandboxRunCloseRow) => {
      const index = rows.findIndex((candidate) => candidate.id === row.id)
      const existing = rows[index]
      if (existing === undefined) return
      rows[index] = {
        ...existing,
        endedAt: row.endedAt,
        costUsd: row.costUsd,
        costSource: row.costSource,
        activeCpuMs: row.activeCpuMs,
        awakeMs: row.awakeMs,
      }
    },
    meterRun: async (params: MeterSandboxRunParams) => {
      const index = rows.findIndex((candidate) => candidate.id === params.id)
      const existing = rows[index]
      if (existing === undefined) return
      rows[index] = {
        ...existing,
        costUsd: params.costUsd,
        costSource: ESandboxCostSource.Metered,
        awakeMs: params.awakeMs,
      }
    },
    runsForSession: async (sessionId) => rows.filter((row) => row.sessionId === sessionId),
    runsForInstance: async (sandboxInstanceId) =>
      rows.filter((row) => row.sandboxInstanceId === sandboxInstanceId),
  }
}

const recorderOf = (store: SandboxRunStore) =>
  sandboxRunRecorderOf({ store, ids: () => `run-${Math.random()}`, now: () => 0 })

const openParams = {
  sessionId: 'ses-1',
  provider: ESandboxCostProvider.Vercel,
  vcpus: 4,
  memoryGb: 8,
  diskGb: 0,
  at: 0,
}

describe('sandbox run recorder', () => {
  test('opening a run twice keeps the first one', async () => {
    const store = memoryStoreOf()
    const recorder = recorderOf(store)
    await recorder.open(openParams)
    await recorder.open({ ...openParams, at: 1_000 })
    expect(store.rows).toHaveLength(1)
    expect(store.rows[0]?.startedAt).toBe(0)
  })

  test('closing measures the cpu since the baseline', async () => {
    const store = memoryStoreOf()
    const recorder = recorderOf(store)
    await recorder.open({ ...openParams, cpuBaselineMs: 2_000 })
    await recorder.close({ sessionId: 'ses-1', at: 60_000, cpuCumulativeMs: 62_000 })
    const row = store.rows[0]
    expect(row?.endedAt).toBe(60_000)
    expect(row?.activeCpuMs).toBe(60_000)
    expect(row?.costSource).toBe(ESandboxCostSource.Measured)
    expect(row?.costUsd).toBeCloseTo((0.128 * 60_000) / HOUR + (0.0212 * 8 * 60_000) / HOUR, 9)
  })

  test('closing without cpu figures stores an estimate', async () => {
    const store = memoryStoreOf()
    const recorder = recorderOf(store)
    await recorder.open(openParams)
    await recorder.close({ sessionId: 'ses-1', at: 60_000 })
    expect(store.rows[0]?.costSource).toBe(ESandboxCostSource.Estimate)
    expect(store.rows[0]?.costUsd).toBeCloseTo((0.0212 * 8 * 60_000) / HOUR, 9)
  })

  test('closing a session with no open run does nothing', async () => {
    const store = memoryStoreOf()
    await recorderOf(store).close({ sessionId: 'ses-1', at: 60_000 })
    expect(store.rows).toHaveLength(0)
  })

  test('compute sums closed runs and estimates the open one', async () => {
    const store = memoryStoreOf()
    const recorder = recorderOf(store)
    await recorder.open({ ...openParams, at: 0 })
    await recorder.close({ sessionId: 'ses-1', at: 60_000 })
    await recorder.open({ ...openParams, at: 120_000 })
    const compute = await recorder.compute({ sessionId: 'ses-1', at: 180_000 })
    expect(compute.running).toBe(true)
    expect(compute.costUsd).toBeCloseTo((0.0212 * 8 * 120_000) / HOUR, 6)
  })
})

describe('sandbox run metering', () => {
  const instanceRun = {
    ...openParams,
    provider: ESandboxCostProvider.Agent37,
    sandboxInstanceId: 'ins-1',
    diskGb: 32,
  }

  const twoRunsOf = async () => {
    const store = memoryStoreOf()
    const recorder = recorderOf(store)
    await recorder.open({ ...instanceRun, at: 0 })
    await recorder.close({ sessionId: 'ses-1', at: 30 * 60_000 })
    await recorder.open({ ...instanceRun, sessionId: 'ses-2', at: 30 * 60_000 })
    await recorder.close({ sessionId: 'ses-2', at: 60 * 60_000 })
    return { store, recorder }
  }

  test('splits the billed compute across closed runs by awake time', async () => {
    const { store, recorder } = await twoRunsOf()
    const metered = await recorder.meter({
      sandboxInstanceId: 'ins-1',
      computeMicros: 1_000_000,
      from: 0,
      to: 2 * HOUR,
    })
    expect(metered).toBe(2)
    expect(store.rows[0]?.costUsd).toBeCloseTo(0.5, 9)
    expect(store.rows[1]?.costUsd).toBeCloseTo(0.5, 9)
    expect(store.rows[0]?.costSource).toBe(ESandboxCostSource.Metered)
  })

  test('metering a run twice bills it once', async () => {
    const { store, recorder } = await twoRunsOf()
    await recorder.meter({
      sandboxInstanceId: 'ins-1',
      computeMicros: 1_000_000,
      from: 0,
      to: 2 * HOUR,
    })
    const again = await recorder.meter({
      sandboxInstanceId: 'ins-1',
      computeMicros: 1_000_000,
      from: 0,
      to: 2 * HOUR,
    })
    expect(again).toBe(0)
    expect(store.rows[0]?.costUsd).toBeCloseTo(0.5, 9)
  })
})
