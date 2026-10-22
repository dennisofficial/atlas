import { afterEach, describe, expect, it } from 'bun:test'

import { toRunId } from '@dltech/atlas-core'

import { EServeFrame, ETurnStatus } from '@dltech/atlas-harness'

import {
  attach,
  gate,
  releaseServing,
  startServing,
  threadId,
  until,
} from './serve-remote-fixture'

afterEach(releaseServing)

describe('a real remote channel over a real serve socket', () => {
  it('stays working through a second, autonomously woken turn', async () => {
    const held = gate()
    const entered = gate()
    const { handle, app } = await startServing({
      holdStep: (step) => {
        if (step !== 2) return undefined
        entered.open()
        return held.opened
      },
    })
    const client = await attach({ port: handle.port })

    client.channel.send({ text: 'first' })
    await until({ what: 'the first outcome', condition: () => client.outcomes.length === 1 })
    expect(client.workingNow()).toBe(false)

    app.pending?.forThread({ threadId }).enqueue({ text: 'a shell finished' })
    await entered.opened
    await until({
      what: 'the working signal of the woken turn',
      condition: () => client.workingNow(),
    })

    expect(client.reloads).toEqual([])
    held.open()
    await until({ what: 'the second outcome', condition: () => client.outcomes.length === 2 })
    expect(client.workingNow()).toBe(false)
    expect(client.reloads).toEqual([])
  })

  it('reports a late subscriber busy from the ready alone, mid-turn', async () => {
    const held = gate()
    const entered = gate()
    const { handle } = await startServing({
      holdStep: (step) => {
        if (step !== 1) return undefined
        entered.open()
        return held.opened
      },
    })
    const first = await attach({ port: handle.port })
    first.channel.send({ text: 'first' })
    await entered.opened

    const late = await attach({ port: handle.port })

    expect(late.workingNow()).toBe(true)
    held.open()
    await until({
      what: 'the late client to see the outcome',
      condition: () => late.outcomes.length === 1,
    })
    expect(late.workingNow()).toBe(false)
  })

  it('reads a fresh attach during the policy tail as idle, since the outcome is already out', async () => {
    const policy = gate()
    const { handle } = await startServing({ holdPolicy: policy.opened })
    const first = await attach({ port: handle.port })
    first.channel.send({ text: 'first' })
    await until({ what: 'the first outcome', condition: () => first.outcomes.length === 1 })

    const fresh = await attach({ port: handle.port })

    expect(fresh.readyInFlight()).toBe(false)
    expect(fresh.workingNow()).toBe(false)
    policy.open()
    await Bun.sleep(20)
    expect(fresh.workingNow()).toBe(false)
  })

  it('keeps a fresh attach busy while the family settles before the outcome goes out', async () => {
    const children = gate()
    const { handle } = await startServing({
      runTurn: ({ pause }) =>
        new Promise((resolve) => {
          const check = () => {
            if (pause?.paused !== true) return void setTimeout(check, 1)
            resolve({ status: ETurnStatus.RelocationPaused, runId: toRunId('run-1') })
          }
          check()
        }),
      family: { pauseChildren: () => children.opened },
    })
    const first = await attach({ port: handle.port })
    first.channel.send({ text: 'go' })
    await Bun.sleep(10)
    first.channel.pause()
    await Bun.sleep(30)

    const fresh = await attach({ port: handle.port })

    expect(fresh.readyInFlight()).toBe(true)
    expect(first.outcomes).toEqual([])
    children.open()
    await until({ what: 'the relocation outcome', condition: () => fresh.outcomes.length === 1 })
  })

  it('resumes after a drop and still delivers the outcome of the turn it missed', async () => {
    const { handle, app } = await startServing()
    const client = await attach({ port: handle.port })
    client.channel.send({ text: 'first' })
    await until({ what: 'the first outcome', condition: () => client.outcomes.length === 1 })

    client.drop()
    await until({
      what: 'the drop to schedule a retry',
      condition: () => client.retries.length === 1,
    })
    app.pending?.forThread({ threadId }).enqueue({ text: 'woken while away' })
    await until({
      what: 'the serve to commit the woken message',
      condition: () =>
        app.appended.some((draft) => draft.type === 'user-said' && draft.text === 'woken while away'),
    })
    await Bun.sleep(50)
    client.retries[0]?.()
    await until({
      what: 'the missed outcome',
      condition: () => new Set(client.outcomes.map((outcome) => outcome.runId)).size === 2,
    })

    expect(client.reloads).toEqual([])
    expect(client.outcomes.every((outcome) => outcome.status === ETurnStatus.Completed)).toBe(true)
    expect(client.workingNow()).toBe(false)
  })

  it('still recovers when working signals are really lost on the wire', async () => {
    const { handle } = await startServing()
    const client = await attach({
      port: handle.port,
      dropFrame: (frame) =>
        frame.kind === EServeFrame.Signal &&
        frame.signal.type === 'turn-working' &&
        frame.signal.working &&
        frame.seq > 0,
    })

    client.channel.send({ text: 'first' })
    await until({ what: 'the first outcome', condition: () => client.outcomes.length === 1 })
    client.channel.send({ text: 'second' })
    await until({ what: 'the second outcome', condition: () => client.outcomes.length === 2 })

    expect(client.reloads.length).toBeGreaterThan(0)
    expect(client.workingNow()).toBe(false)
  })
})
