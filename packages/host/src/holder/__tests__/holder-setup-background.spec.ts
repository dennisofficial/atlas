import { describe, expect, it } from 'bun:test'
import { ESetupPhase } from '@dltech/atlas-core'
import { ScriptedModel } from '@dltech/atlas-agent/testing'

import type { SetupLifecycle } from '../ports'
import { flushUntil, makeRig, seedSession, THREAD_ID } from './holder-rig'

const setupHandle = () => {
  const listeners: ((lifecycle: SetupLifecycle) => void)[] = []
  const emit = (lifecycle: SetupLifecycle): void => {
    for (const listener of [...listeners]) listener(lifecycle)
  }
  return {
    subscribe: (listener: (lifecycle: SetupLifecycle) => void): void => {
      listeners.push(listener)
    },
    started: (script: string): void => emit({ phase: ESetupPhase.Started, script }),
    finished: (args: { script: string; ok: boolean }): void =>
      emit({
        phase: ESetupPhase.Finished,
        script: args.script,
        ok: args.ok,
        durationMs: 1_400,
        output: args.ok ? 'installed 412 packages' : 'boom-marker',
      }),
  }
}

const typesOf = async (rig: Awaited<ReturnType<typeof makeRig>>): Promise<string[]> =>
  (await rig.events()).map((event) => event.type)

const noticesOf = async (rig: Awaited<ReturnType<typeof makeRig>>) => {
  const page = await rig.plane.readEvents({
    threadId: THREAD_ID,
    afterSeq: 0,
    limit: 100,
    visible: false,
  })
  return page.events.filter((event) => event.type === 'sandbox-setup-reported')
}

const rigWith = async (args: {
  model: ScriptedModel
  setup: ReturnType<typeof setupHandle>
}): Promise<Awaited<ReturnType<typeof makeRig>>> => {
  const rig = await makeRig({
    model: () => args.model,
    subscribeSetup: args.setup.subscribe,
    prepare: async () => {
      args.setup.started('bun install')
      return { ok: true }
    },
  })
  await seedSession(rig)
  await rig.post('hello')
  await rig.holder.start()
  await rig.wake()
  return rig
}

describe('a setup script that runs in the background', () => {
  it('records the started notice before workspace-prepared so the first turn sees it', async () => {
    const setup = setupHandle()
    const model = new ScriptedModel([{ text: 'one' }, { text: 'two' }])
    const rig = await rigWith({ model, setup })
    await flushUntil({ check: async () => (await typesOf(rig)).includes('assistant-said') })

    const types = await typesOf(rig)
    expect(types.indexOf('sandbox-setup-reported')).toBeLessThan(
      types.indexOf('workspace-prepared'),
    )
    expect(types.indexOf('workspace-prepared')).toBeLessThan(types.indexOf('user-said'))
    expect(await noticesOf(rig)).toHaveLength(1)
    expect(JSON.stringify(model.requests[0]?.assembled.messages)).toContain(
      'started in the background',
    )
    expect(JSON.stringify(model.requests[0]?.assembled.messages)).toContain('bun install')
    rig.holder.discard()
  })

  it('starts the first turn, and keeps the session held, while the script is still running', async () => {
    const setup = setupHandle()
    const model = new ScriptedModel([{ text: 'one' }, { text: 'two' }])
    const rig = await makeRig({
      model: () => model,
      idleMinutes: 1,
      subscribeSetup: setup.subscribe,
      prepare: async () => {
        setup.started('bun install')
        return { ok: true }
      },
    })
    await seedSession(rig)
    await rig.holder.start()
    await rig.wake()
    await flushUntil({ check: async () => (await typesOf(rig)).includes('workspace-prepared') })
    rig.clock.advance(120_000)
    await rig.flush()

    expect(rig.runtimes[0]?.released).toBe(false)
    expect(rig.holder.heldIds().length).toBe(1)
    rig.holder.discard()
  })

  it('wakes an idle session with the finished notice of a successful script', async () => {
    const setup = setupHandle()
    const model = new ScriptedModel([{ text: 'one' }, { text: 'two' }])
    const rig = await rigWith({ model, setup })
    await flushUntil({ check: async () => (await typesOf(rig)).includes('assistant-said') })
    await rig.flush()
    expect(model.requests).toHaveLength(1)

    setup.finished({ script: 'bun install', ok: true })
    const woken = await flushUntil({ check: () => model.requests.length > 1, attempts: 200 })
    expect(woken).toBe(true)

    const types = await typesOf(rig)
    expect(types.filter((type) => type === 'assistant-said')).toHaveLength(2)
    const notices = await noticesOf(rig)
    expect(notices).toHaveLength(2)
    expect(notices[1]).toMatchObject({ phase: ESetupPhase.Finished, failed: false })
    expect(String(notices[1]?.text)).toContain('finished after 1.4s')
    expect(JSON.stringify(model.requests[1]?.assembled.messages)).toContain('finished after 1.4s')
    rig.holder.discard()
  })

  it('wakes an idle session with a failed notice and its output tail', async () => {
    const setup = setupHandle()
    const model = new ScriptedModel([{ text: 'one' }, { text: 'two' }])
    const rig = await rigWith({ model, setup })
    await flushUntil({ check: async () => (await typesOf(rig)).includes('assistant-said') })
    await rig.flush()

    setup.finished({ script: 'bun install', ok: false })
    const woken = await flushUntil({ check: () => model.requests.length > 1, attempts: 200 })
    expect(woken).toBe(true)

    const notices = await noticesOf(rig)
    expect(notices).toHaveLength(2)
    expect(notices[1]).toMatchObject({ phase: ESetupPhase.Finished, failed: true })
    expect(String(notices[1]?.text)).toContain('boom-marker')
    expect(JSON.stringify(model.requests[1]?.assembled.messages)).toContain('boom-marker')
    rig.holder.discard()
  })

  it('records the finished notice without starting another turn while one is running', async () => {
    const setup = setupHandle()
    const model = new ScriptedModel([
      { text: 'a long first answer', streamMs: 40 },
      { text: 'two' },
    ])
    const rig = await rigWith({ model, setup })
    await flushUntil({ check: () => model.requests.length > 0, attempts: 200 })

    setup.finished({ script: 'bun install', ok: true })
    const settled = await flushUntil({
      check: async () =>
        (await typesOf(rig)).includes('assistant-said') && (await noticesOf(rig)).length === 2,
      attempts: 500,
    })
    await rig.flush()
    expect(settled).toBe(true)

    const types = await typesOf(rig)
    expect(types).not.toContain('run-failed')
    expect(model.requests.length).toBeLessThanOrEqual(2)
    rig.holder.discard()
  })
})
