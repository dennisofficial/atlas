import { describe, expect, it } from 'bun:test'

import { EMessageOrigin, type ModelPort, type SpawnFile, type V2Event } from '@dltech/atlas-core'
import { ScriptedModel } from '@dltech/atlas-agent/testing'
import { createInMemoryDaemon } from '@dltech/atlas-protocol/testing'

import { DaemonFileSystemPort } from '../../calls/ports/filesystem'
import {
  CONTEXT_DIRECTORY,
  flushUntil,
  makeRig,
  SANDBOX,
  SECRET,
  seedSession,
  SESSION,
  THREAD_ID,
} from './holder-rig'
import type { HolderRig } from './holder-rig'

const FILES: readonly SpawnFile[] = [
  { path: 'plan.md', text: 'the plan' },
  { path: 'sections/03-auth.md', text: 'the auth section' },
]

const readAt = (rig: HolderRig, path: string): Promise<string> => {
  const runtime = rig.runtimes[0]
  if (runtime === undefined) throw new Error('the rig never built a runtime')
  return new DaemonFileSystemPort({ calls: runtime.remoteCalls }).readFile({
    path: `${CONTEXT_DIRECTORY}/${path}`,
  })
}

const postWithFiles = async (rig: HolderRig, text: string): Promise<void> => {
  await rig.plane.post({
    sessionId: SESSION,
    kind: 'message',
    payload: JSON.stringify({ text, via: EMessageOrigin.PeerAgent, files: FILES }),
  })
}

const answered = async (rig: HolderRig): Promise<boolean> =>
  flushUntil({
    check: async () => (await rig.events()).some((event) => event.type === 'assistant-said'),
  })

const recordOf = async (rig: HolderRig): Promise<readonly V2Event[]> => {
  const page = await rig.plane.readEvents({
    threadId: THREAD_ID,
    afterSeq: 0,
    limit: 1_000,
    visible: false,
  })
  return page.events
}

class Prober implements ModelPort {
  readonly placedBeforeTheStep: number[] = []
  readonly textsAtTheStep: string[] = []
  readonly textsAfterPlacingAgain: string[] = []

  constructor(
    private readonly args: {
      inner: ModelPort
      rig: () => HolderRig
      place: () => Promise<unknown>
    },
  ) {}

  get identity(): ModelPort['identity'] {
    return this.args.inner.identity
  }

  step: ModelPort['step'] = async (step) => {
    const rig = this.args.rig()
    const runtime = rig.runtimes[0]
    this.placedBeforeTheStep.push(runtime?.placedContextFiles.length ?? 0)
    this.textsAtTheStep.push(await readAt(rig, 'plan.md'))
    await this.args.place()
    this.textsAfterPlacingAgain.push(await readAt(rig, 'plan.md'))
    return await this.args.inner.step(step)
  }
}

class Reader implements ModelPort {
  readonly textsAtTheStep: string[] = []

  constructor(private readonly args: { inner: ModelPort; rig: () => HolderRig }) {}

  get identity(): ModelPort['identity'] {
    return this.args.inner.identity
  }

  step: ModelPort['step'] = async (step) => {
    this.textsAtTheStep.push(await readAt(this.args.rig(), 'plan.md'))
    return await this.args.inner.step(step)
  }
}

describe('SessionHolder context files', () => {
  it('places the attached files before the first model step, and placing again keeps them', async () => {
    let rig: HolderRig
    const prober = new Prober({
      inner: new ScriptedModel([{ text: 'read them' }]),
      rig: () => rig,
      place: async () => {
        const runtime = rig.runtimes[0]
        if (runtime?.placeContextFiles === undefined) throw new Error('the rig places no files')
        await runtime.placeContextFiles({ files: FILES })
      },
    })
    rig = await makeRig({ model: () => prober })
    await seedSession(rig)
    await postWithFiles(rig, 'read the plan and the auth section')
    await rig.holder.start()
    await rig.wake()

    expect(await answered(rig)).toBe(true)
    expect(rig.runtimes[0]?.placedContextFiles).toEqual([FILES, FILES])
    expect(prober.placedBeforeTheStep).toEqual([1])
    expect(prober.textsAtTheStep).toEqual(['the plan'])
    expect(prober.textsAfterPlacingAgain).toEqual(['the plan'])
    expect((await rig.events()).some((event) => event.type === 'workspace-prepare-failed')).toBe(
      false,
    )
  })

  it('places nothing for a message that attaches no files', async () => {
    const rig = await makeRig({})
    await seedSession(rig)
    await rig.post('just a message')
    await rig.holder.start()
    await rig.wake()

    expect(await answered(rig)).toBe(true)
    expect(rig.runtimes[0]?.placedContextFiles).toEqual([])
  })

  it('fails the prepare durably, and starts no turn, when a file cannot be placed', async () => {
    const rig = await makeRig({
      placeContextFiles: async () => {
        throw new Error('the pod disk is full')
      },
    })
    await seedSession(rig)
    await postWithFiles(rig, 'read the plan')
    await rig.holder.start()
    await rig.wake()

    const failed = await flushUntil({
      check: async () =>
        (await rig.events()).some((event) => event.type === 'workspace-prepare-failed'),
    })
    expect(failed).toBe(true)
    const failure = (await recordOf(rig)).find(
      (event): event is Extract<V2Event, { type: 'workspace-prepare-failed' }> =>
        event.type === 'workspace-prepare-failed',
    )
    expect(failure?.reason).toContain('the pod disk is full')
    expect((await rig.events()).some((event) => event.type === 'assistant-said')).toBe(false)
  })

  it('fails the prepare durably when a stored path is refused', async () => {
    const rig = await makeRig({
      placeContextFiles: async () => ({ written: 0, refused: ['../outside.md is outside'] }),
    })
    await seedSession(rig)
    await postWithFiles(rig, 'read the plan')
    await rig.holder.start()
    await rig.wake()

    expect(
      await flushUntil({
        check: async () =>
          (await rig.events()).some((event) => event.type === 'workspace-prepare-failed'),
      }),
    ).toBe(true)
    const failure = (await recordOf(rig)).find(
      (event): event is Extract<V2Event, { type: 'workspace-prepare-failed' }> =>
        event.type === 'workspace-prepare-failed',
    )
    expect(failure?.reason).toContain('../outside.md is outside')
    expect((await rig.events()).some((event) => event.type === 'assistant-said')).toBe(false)
  })

  it('places the files again on a replacement pod, before its first model step', async () => {
    const first = await makeRig({})
    await seedSession(first)
    await postWithFiles(first, 'read the plan')
    await first.holder.start()
    await first.wake()
    expect(await answered(first)).toBe(true)
    expect(first.runtimes[0]?.placedContextFiles).toEqual([FILES])
    await first.holder.drain()

    const pod = await createInMemoryDaemon({
      version: 'test',
      sandboxName: SANDBOX,
      secret: SECRET,
    })
    let second: HolderRig
    const reader = new Reader({
      inner: new ScriptedModel([{ text: 'the files are back' }]),
      rig: () => second,
    })
    second = await makeRig({
      plane: first.plane,
      store: first.store,
      bus: first.bus,
      clock: first.clock,
      daemon: pod,
      model: () => reader,
    })
    await second.holder.start()
    await second.post('read the plan again')
    await second.bus.wake(SESSION)

    expect(await flushUntil({ check: async () => reader.textsAtTheStep.length > 0 })).toBe(true)
    expect(second.runtimes[0]?.placedContextFiles).toEqual([FILES])
    expect(reader.textsAtTheStep).toEqual(['the plan'])
  })
})
