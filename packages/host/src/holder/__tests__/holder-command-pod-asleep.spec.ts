import { describe, expect, it } from 'bun:test'

import {
  composeCommands,
  defineCommand,
  ECommandGroup,
  ECommandRunsIn,
  type CommandHandler,
} from '@dltech/atlas-commands'
import { z } from 'zod'

import { flushUntil, makeRig, seedSession, SESSION, THREAD_ID } from './holder-rig'

const note = defineCommand({
  spec: {
    name: 'note',
    summary: 'records a fact without the pod',
    group: ECommandGroup.Session,
    args: z.strictObject({}),
    runsIn: ECommandRunsIn.Host,
    fromText: () => ({ ok: true, args: {} }),
  },
})

describe('SessionHolder command intake while the pod sleeps', () => {
  it('consumes a host command without waiting for the pod to answer a shell count', async () => {
    const shells = { asked: 0, askedBeforeNote: -1 }
    const recordNote: CommandHandler<unknown> = async ({ append }) => {
      shells.askedBeforeNote = shells.asked
      await append([{ type: 'fact-recorded', key: 'note', kind: 'test', value: 'done' }])
      return { kind: 'done' }
    }
    const rig = await makeRig({
      commands: composeCommands([note]),
      commandHandlers: new Map([[note.inboxKind, recordNote]]),
      runningShells: () => {
        shells.asked += 1
        return new Promise<number>(() => {})
      },
    })
    await seedSession(rig)
    await rig.holder.start()
    await rig.plane.post({ sessionId: SESSION, kind: note.inboxKind, payload: '{}' })
    await rig.wake()

    const recorded = await flushUntil({
      check: async () =>
        (
          await rig.plane.readEvents({
            threadId: THREAD_ID,
            afterSeq: 0,
            limit: 100,
            visible: false,
          })
        ).events.some((event) => event.type === 'fact-recorded'),
    })
    expect(recorded).toBe(true)
    expect(shells.askedBeforeNote).toBe(0)
  })
})
