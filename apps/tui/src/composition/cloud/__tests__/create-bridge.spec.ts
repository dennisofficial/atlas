import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'
import { SandboxClient } from '@dltech/atlas-harness'

import { parkedEscalationOf } from '../create-bridge'

const THREAD = toThreadId('brn_cloud')

const sandboxesReplying = (reply: { status?: number; body?: unknown }): SandboxClient => {
  const fetchFn = (async (_input: unknown, _init?: RequestInit) =>
    new Response(reply.body === undefined ? '' : JSON.stringify(reply.body), {
      status: reply.status ?? 200,
    })) as typeof fetch

  return new SandboxClient({ url: 'https://cloud.test/', token: 'sess_test', fetchFn })
}

describe('parkedEscalationOf', () => {
  it('escalates when the control plane reports the sandbox parked', async () => {
    const sandboxes = sandboxesReplying({ body: { state: 'parked' } })

    expect(await parkedEscalationOf({ sandboxes, threadId: THREAD })()).toBe(true)
  })

  it('stays put for a sandbox that is running', async () => {
    const sandboxes = sandboxesReplying({
      body: { state: 'running', url: 'https://box.vercel.run' },
    })

    expect(await parkedEscalationOf({ sandboxes, threadId: THREAD })()).toBe(false)
  })

  it('stays put for a sandbox that is only resuming', async () => {
    const sandboxes = sandboxesReplying({ body: { state: 'resuming' } })

    expect(await parkedEscalationOf({ sandboxes, threadId: THREAD })()).toBe(false)
  })

  it('swallows a control-plane failure rather than escalating on a guess', async () => {
    const sandboxes = sandboxesReplying({ status: 500, body: { message: 'vercel said no' } })

    expect(await parkedEscalationOf({ sandboxes, threadId: THREAD })()).toBe(false)
  })
})
