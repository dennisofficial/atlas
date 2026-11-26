import { describe, expect, it } from 'bun:test'

import {
  ECallFailure,
  ECallStatus,
  EChangeSide,
  EServiceRunStatus,
  type CallOp,
  type CallResult,
  type ServiceInfo,
} from '@dltech/atlas-protocol'

import { runInCallScope } from '../../calls/call-scope'
import { failedResult } from '../../calls/remote-calls-frames'
import { stepDigestOf } from '../../calls/step-digest'
import { pluginCallOf, type PluginSteps } from '../plugin-call'
import type { RecordedStep, StepRecord } from '../record/call-steps'

const DB_ROW: ServiceInfo = {
  serviceId: 'db',
  command: 'bun run db',
  pid: 4242,
  port: 5432,
  status: EServiceRunStatus.Ready,
  exitCode: null,
  signal: null,
  startedAt: 1,
}

const listResult = (rows: readonly ServiceInfo[]): CallResult => ({
  status: ECallStatus.Ok,
  op: 'services.list',
  value: [...rows],
})

const harnessOf = (
  args: {
    recorded?: readonly RecordedStep[] | undefined
    answer?: ((request: { op: CallOp; replayed: boolean }) => CallResult) | undefined
  } = {},
) => {
  const recorded: RecordedStep[] = [...(args.recorded ?? [])]
  const invoked: { key: string; op: CallOp; replayed: boolean }[] = []
  const acked: string[] = []
  const steps: PluginSteps = {
    recorded: () => recorded,
    record: async (step: StepRecord) => {
      recorded.push({ ...step })
    },
  }
  const call = pluginCallOf({
    invoke: async (request) => {
      invoked.push({ key: request.key, op: request.op, replayed: request.replayed === true })
      if (args.answer !== undefined) {
        return args.answer({ op: request.op, replayed: request.replayed === true })
      }
      return failedResult({ op: request.op.op, code: ECallFailure.Cancelled, message: 'stub' })
    },
    steps,
    bootId: () => 'boot-a',
    ack: async (key) => {
      acked.push(key)
    },
  })
  return { call, recorded, invoked, acked }
}

const inScope = <T>(body: () => Promise<T>): Promise<T> =>
  runInCallScope({ scopeKey: 'call-1', body })

const READ_PATTERN = /^call-1\.read\.[0-9a-f]{8}$/

const STALE_LIST: readonly RecordedStep[] = [
  {
    key: 'call-1.0',
    op: 'services.list',
    digest: stepDigestOf({ op: 'services.list' }),
    bootId: 'boot-a',
  },
]

describe('pluginCallOf on a read-only daemon op', () => {
  it('answers a replayed services.list from the pod, never from the recorded list', async () => {
    const harness = harnessOf({
      recorded: STALE_LIST,
      answer: ({ replayed }) => listResult(replayed ? [] : [DB_ROW]),
    })
    const result = await inScope(() => harness.call({ op: 'services.list' }))

    expect(result).toEqual(listResult([DB_ROW]))
    expect(harness.invoked[0]?.replayed).toBe(false)
    expect(harness.invoked[0]?.key).toMatch(READ_PATTERN)
  })

  it('keeps the recorded list and records no step for a replayed services.list', async () => {
    const harness = harnessOf({ recorded: STALE_LIST, answer: () => listResult([]) })
    await inScope(async () => {
      await harness.call({ op: 'services.list' })
      await harness.call({ op: 'services.list' })
    })

    const keys = harness.invoked.map((call) => call.key)
    expect(keys.every((key) => READ_PATTERN.test(key))).toBe(true)
    expect(new Set(keys).size).toBe(2)
    expect(harness.recorded).toHaveLength(1)
  })

  it('gives every step-free op a distinct fresh key and acks it', async () => {
    const harness = harnessOf()
    const ops: readonly CallOp[] = [
      { op: 'services.list' },
      { op: 'services.log', serviceId: 'db', offset: 0, limit: 10 },
      { op: 'shells.list' },
      { op: 'shells.read', shellId: 'shell-1', offset: 0, limit: 10 },
      { op: 'terminal.read', terminalId: 'term-1', offset: 0 },
      { op: 'previews.status' },
      { op: 'git.read', repoPath: '/w' },
      { op: 'digestFile', path: '/w/a' },
      { op: 'oom.list' },
      { op: 'watch.status', watchIds: ['watch-1'] },
      { op: 'changes.scan', repoPath: '/w', base: 'main' },
      {
        op: 'changes.read',
        repoPath: '/w',
        base: 'main',
        path: 'a',
        oldPath: null,
        side: EChangeSide.Current,
      },
    ]
    await inScope(async () => {
      for (const op of ops) await harness.call(op)
    })

    const keys = harness.invoked.map((call) => call.key)
    expect(keys.every((key) => READ_PATTERN.test(key))).toBe(true)
    expect(new Set(keys).size).toBe(ops.length)
    expect(harness.recorded).toHaveLength(0)
    expect(harness.acked).toHaveLength(ops.length)
  })

  it('still records an op that changes the pod as a step', async () => {
    const harness = harnessOf()
    await inScope(async () => {
      await harness.call({
        op: 'services.start',
        serviceId: 'db',
        command: 'bun run db',
        cwd: '/w',
      })
      await harness.call({ op: 'git.discover', root: '/w' })
    })

    expect(harness.invoked.map((call) => call.key)).toEqual(['call-1.0', 'call-1.1'])
    expect(harness.invoked.every((call) => !call.replayed)).toBe(true)
    expect(harness.recorded.map((step) => step.op)).toEqual(['services.start', 'git.discover'])
    expect(harness.acked).toHaveLength(0)
  })
})
