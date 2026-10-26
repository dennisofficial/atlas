import { describe, expect, it } from 'bun:test'

import { EServeFrame } from '@dltech/atlas-client/channel'

import { flush, rig } from './live-thread-fixture'

const request = { requestId: 'opin_1', description: 'Paste the code', path: '/tmp/code' }

async function startLive() {
  const test = rig()
  test.controller.start()
  await flush()
  test.ready()
  await flush()
  return test
}

const signal = async (args: {
  test: Awaited<ReturnType<typeof startLive>>
  seq: number
  value: unknown
}) => {
  args.test.receive({
    kind: EServeFrame.Signal,
    seq: args.seq,
    signal: { type: 'operator-input', request: args.value as typeof request | null },
  })
  await flush()
}

describe('live thread operator input', () => {
  it('starts without a request', async () => {
    expect((await startLive()).state().operatorInput).toBeNull()
  })

  it('holds the request serve asks for and clears it when answered', async () => {
    const test = await startLive()
    await signal({ test, seq: 1, value: request })
    expect(test.state().operatorInput).toEqual(request)

    await signal({ test, seq: 2, value: null })
    expect(test.state().operatorInput).toBeNull()
  })

  it('drops the request when the pod parks', async () => {
    const test = await startLive()
    await signal({ test, seq: 1, value: request })

    test.receive({ kind: EServeFrame.Parked, reason: 'idle' })
    await flush()

    expect(test.state().operatorInput).toBeNull()
  })
})
