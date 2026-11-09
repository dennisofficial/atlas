import { describe, expect, it } from 'bun:test'

import { podControlStub } from '@dltech/atlas-plugin-sdk/testing'
import { ECallFailure, ECallStatus, type CallOp, type CallResult } from '@dltech/atlas-protocol'

import { exposeService, stopPreview } from '../expose'
import { controlOf } from './support'

const answer = (op: CallOp): CallResult => {
  if (op.op === 'previews.expose') {
    return { status: ECallStatus.Ok, op: 'previews.expose', value: { port: op.port, pid: 7 } }
  }
  if (op.op === 'previews.stop') {
    return { status: ECallStatus.Ok, op: 'previews.stop', value: { stopped: true } }
  }
  throw new Error(`unexpected op ${op.op}`)
}

const recorder = () => {
  const calls: CallOp[] = []
  const logged: string[] = []
  return {
    calls,
    logged,
    call: async (op: CallOp): Promise<CallResult> => {
      calls.push(op)
      return answer(op)
    },
    log: (message: string) => void logged.push(message),
  }
}

describe('exposeService', () => {
  it('returns the url the control plane handed out and gives the daemon the token', async () => {
    const rig = recorder()
    const exposed = await exposeService({
      ctx: { control: controlOf({ url: 'https://six-words.trycloudflare.com' }), call: rig.call },
      port: 3000,
    })
    expect(exposed).toEqual({ ok: true, url: 'https://six-words.trycloudflare.com' })
    expect(rig.calls).toEqual([{ op: 'previews.expose', port: 3000, tunnelToken: 'tunnel-token' }])
  })

  it('names the control plane when publishing fails, and does not start a tunnel', async () => {
    const rig = recorder()
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

  it('names cloudflared when the daemon cannot start the tunnel', async () => {
    const exposed = await exposeService({
      ctx: {
        control: controlOf({ url: 'https://six-words.trycloudflare.com' }),
        call: async () => ({
          status: ECallStatus.Failed,
          op: 'previews.expose',
          error: { code: ECallFailure.SpawnFailed, message: 'this pod has no cloudflared binary' },
        }),
      },
      port: 3000,
    })
    expect(exposed.ok).toBe(false)
    expect(exposed.ok ? '' : exposed.reason).toContain('cloudflared did not start')
    expect(exposed.ok ? '' : exposed.reason).toContain('no cloudflared binary')
  })
})

describe('stopPreview', () => {
  it('stops the preview of a port', async () => {
    const rig = recorder()
    await stopPreview({ ctx: { call: rig.call, log: rig.log }, port: 3000 })
    expect(rig.calls).toEqual([{ op: 'previews.stop', port: 3000 }])
    expect(rig.logged).toEqual([])
  })

  it('does nothing without a port', async () => {
    const rig = recorder()
    await stopPreview({ ctx: { call: rig.call, log: rig.log }, port: undefined })
    expect(rig.calls).toEqual([])
  })

  it('logs a failure instead of throwing', async () => {
    const rig = recorder()
    await stopPreview({
      ctx: {
        call: async () => {
          throw new Error('the daemon is gone')
        },
        log: rig.log,
      },
      port: 3000,
    })
    expect(rig.logged).toEqual([
      'services: stopping the preview on port 3000 failed: the daemon is gone',
    ])
  })
})
