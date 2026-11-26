import { describe, expect, it } from 'bun:test'

import { ECallFailure, type CallOp, type CallResult } from '@dltech/atlas-protocol'

import { runInCallScope } from '../../calls/call-scope'
import { failedResult } from '../../calls/remote-calls-frames'
import { pluginCallOf, type PluginSteps } from '../plugin-call'
import type { RecordedStep, StepRecord } from '../record/call-steps'

const resultOf = (op: CallOp): CallResult =>
  failedResult({ op: op.op, code: ECallFailure.Cancelled, message: 'stub' })

const harnessOf = (
  args: {
    recorded?: readonly RecordedStep[] | undefined
    env?: (() => Promise<Record<string, string>>) | undefined
  } = {},
) => {
  const recorded: RecordedStep[] = [...(args.recorded ?? [])]
  const trace: string[] = []
  const invoked: { key: string; op: CallOp; replayed: boolean; bootId?: string | undefined }[] = []
  const acked: string[] = []
  const steps: PluginSteps = {
    recorded: () => recorded,
    record: async (step: StepRecord) => {
      trace.push(`record ${step.key}`)
      recorded.push({ ...step })
    },
  }
  const call = pluginCallOf({
    invoke: async (request) => {
      trace.push(`invoke ${request.key}`)
      invoked.push({
        key: request.key,
        op: request.op,
        replayed: request.replayed === true,
        bootId: request.dispatchedBootId,
      })
      return resultOf(request.op)
    },
    steps,
    ...(args.env === undefined ? {} : { env: args.env }),
    bootId: () => 'boot-a',
    ack: async (key) => {
      acked.push(key)
    },
  })
  return { call, recorded, trace, invoked, acked }
}

const inScope = <T>(body: () => Promise<T>): Promise<T> =>
  runInCallScope({ scopeKey: 'call-1', body })

describe('pluginCallOf step identity', () => {
  it('records the step before it sends an effectful op', async () => {
    const harness = harnessOf()
    await inScope(() => harness.call({ op: 'exec', argv: ['true'] }))

    expect(harness.trace).toEqual(['record call-1.0', 'invoke call-1.0'])
  })

  it('replays a recorded step under the recorded key instead of sending it fresh', async () => {
    const harness = harnessOf()
    await inScope(() => harness.call({ op: 'exec', argv: ['true'] }))
    await inScope(() => harness.call({ op: 'exec', argv: ['true'] }))

    expect(harness.invoked.map((call) => call.key)).toEqual(['call-1.0', 'call-1.0'])
    expect(harness.invoked.map((call) => call.replayed)).toEqual([false, true])
    expect(harness.recorded).toHaveLength(1)
  })

  it('carries the boot the step was sent on into the replay', async () => {
    const harness = harnessOf()
    await inScope(() => harness.call({ op: 'exec', argv: ['true'] }))
    await inScope(() => harness.call({ op: 'exec', argv: ['true'] }))

    expect(harness.invoked[1]?.bootId).toBe('boot-a')
  })

  it('gives two identical ops in one body two steps', async () => {
    const harness = harnessOf()
    await inScope(async () => {
      await harness.call({ op: 'exec', argv: ['true'] })
      await harness.call({ op: 'exec', argv: ['true'] })
    })

    expect(harness.invoked.map((call) => call.key)).toEqual(['call-1.0', 'call-1.1'])
    expect(harness.invoked.every((call) => !call.replayed)).toBe(true)
  })

  it('never attaches a diverged replay to the recorded step at its position', async () => {
    const harness = harnessOf({
      recorded: [
        { key: 'call-1.0', op: 'exec', digest: 'db', bootId: 'boot-a' },
        { key: 'call-1.2', op: 'exec', digest: 'cache', bootId: 'boot-a' },
      ],
    })
    await inScope(() => harness.call({ op: 'exec', argv: ['api'] }))

    expect(harness.invoked[0]?.key).toBe('call-1.3')
    expect(harness.invoked[0]?.replayed).toBe(false)
  })

  it('keeps a rotated env out of the identity', async () => {
    let token = 'first'
    const harness = harnessOf({ env: async () => ({ GH_TOKEN: token }) })
    await inScope(() => harness.call({ op: 'exec', argv: ['gh', 'pr', 'list'] }))
    token = 'second'
    await inScope(() => harness.call({ op: 'exec', argv: ['gh', 'pr', 'list'] }))

    expect(harness.invoked.map((call) => call.key)).toEqual(['call-1.0', 'call-1.0'])
    expect(harness.invoked[1]?.replayed).toBe(true)
    expect(harness.invoked[1]?.op).toEqual({
      op: 'exec',
      argv: ['gh', 'pr', 'list'],
      env: { GH_TOKEN: 'second' },
    })
  })

  it('gives a read a random key, records nothing and acks it', async () => {
    const harness = harnessOf()
    await inScope(() => harness.call({ op: 'readFile', path: '/w/a' }))

    expect(harness.invoked[0]?.key).toMatch(/^call-1\.read\.[0-9a-f]{8}$/)
    expect(harness.recorded).toHaveLength(0)
    expect(harness.acked).toHaveLength(1)
  })

  it('falls back to a random host key outside a call scope', async () => {
    const harness = harnessOf()
    await harness.call({ op: 'exec', argv: ['true'] })

    expect(harness.invoked[0]?.key).toMatch(/^host-/)
    expect(harness.recorded).toHaveLength(0)
  })
})
