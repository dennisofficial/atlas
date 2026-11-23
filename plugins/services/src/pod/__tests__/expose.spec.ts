import { describe, expect, it } from 'bun:test'

import { podControlStub } from '@dltech/atlas-plugin-sdk/testing'
import {
  ECallFailure,
  ECallStatus,
  type CallOp,
  type CallResult,
  type PreviewTunnelStatus,
} from '@dltech/atlas-protocol'

import { exposeService } from '../expose'
import { controlOf } from './support'

const UP: PreviewTunnelStatus = { state: 'up', pid: 7, restarts: 0, tail: '' }

const answerOf = (args: { ensure?: PreviewTunnelStatus; status?: PreviewTunnelStatus }) => {
  const calls: CallOp[] = []
  const call = async (op: CallOp): Promise<CallResult> => {
    calls.push(op)
    if (op.op === 'previews.ensure') {
      return { status: ECallStatus.Ok, op: 'previews.ensure', value: args.ensure ?? UP }
    }
    if (op.op === 'previews.status') {
      return { status: ECallStatus.Ok, op: 'previews.status', value: args.status ?? UP }
    }
    throw new Error(`unexpected op ${op.op}`)
  }
  return { calls, call }
}

const URL = 'https://seven-labels.byatlas.dev'

describe('exposeService', () => {
  it('returns the url the control plane minted and ensures the pod tunnel once', async () => {
    const rig = answerOf({})
    const exposed = await exposeService({
      ctx: { control: controlOf({ url: URL }), call: rig.call },
      port: 3000,
    })
    expect(exposed).toEqual({ ok: true, url: URL })
    expect(rig.calls).toEqual([{ op: 'previews.ensure', tunnelToken: 'tunnel-token' }])
  })

  it('names the control plane when publishing fails, and never asks the daemon for a tunnel', async () => {
    const rig = answerOf({})
    const exposed = await exposeService({
      ctx: {
        control: {
          ...podControlStub,
          exposePort: async () => {
            throw new Error('the control plane is down')
          },
        },
        call: rig.call,
      },
      port: 3000,
    })
    expect(exposed.ok).toBe(false)
    expect(exposed.ok ? '' : exposed.reason).toContain(
      'the control plane could not publish port 3000',
    )
    expect(exposed.ok ? '' : exposed.reason).toContain('the control plane is down')
    expect(rig.calls).toEqual([])
  })

  it('reports why the tunnel of the pod did not come up', async () => {
    const exposed = await exposeService({
      ctx: {
        control: controlOf({ url: URL }),
        call: async () => ({
          status: ECallStatus.Failed,
          op: 'previews.ensure',
          error: {
            code: ECallFailure.SpawnFailed,
            message: 'cloudflared exited with code 3 before its tunnel connected; output: boom',
          },
        }),
      },
      port: 3000,
    })
    expect(exposed.ok).toBe(false)
    expect(exposed.ok ? '' : exposed.reason).toContain('did not come up for port 3000')
    expect(exposed.ok ? '' : exposed.reason).toContain('code 3')
  })

  it('reports the state of a tunnel the daemon holds but could not keep up', async () => {
    const rig = answerOf({
      ensure: { state: 'starting', restarts: 1, tail: '' },
      status: {
        state: 'failed',
        restarts: 2,
        lastError: 'cloudflared exited with code 1; restarting in 4000 ms',
        tail: 'boom',
      },
    })
    const exposed = await exposeService({
      ctx: { control: controlOf({ url: URL }), call: rig.call },
      port: 4000,
    })
    expect(exposed.ok).toBe(false)
    expect(exposed.ok ? '' : exposed.reason).toContain('the tunnel of this pod is failed')
    expect(exposed.ok ? '' : exposed.reason).toContain('restarting in 4000 ms')
    expect(rig.calls.map((call) => call.op)).toEqual(['previews.ensure', 'previews.status'])
  })

  it('names the daemon when it cannot be reached at all', async () => {
    const exposed = await exposeService({
      ctx: {
        control: controlOf({ url: URL }),
        call: async () => {
          throw new Error('the daemon is gone')
        },
      },
      port: 3000,
    })
    expect(exposed.ok).toBe(false)
    expect(exposed.ok ? '' : exposed.reason).toContain('the daemon did not answer')
    expect(exposed.ok ? '' : exposed.reason).toContain('the daemon is gone')
  })
})
