import { describe, expect, it } from 'bun:test'

import { toCallId, toThreadId } from '@dltech/atlas-core'

import { runInCallScope, scopeDispatchedBootId } from '../../calls/call-scope'
import { SessionRecord } from '../record/record-adapter'
import { makeRig, seedSession, SESSION, THREAD } from './holder-rig'

describe('SessionRecord duplicate dispatch', () => {
  it('a re-dispatched tool-dispatched is dropped and marks the recorded bootId', async () => {
    const rig = await makeRig({})
    await seedSession(rig)
    await rig.holder.start()
    await rig.post('start the runtime')
    await rig.wake()
    await rig.flush()
    const runtime = rig.runtimes[0]
    if (runtime === undefined) throw new Error('no runtime')

    const threadId = toThreadId(THREAD)
    const record = await SessionRecord.open({
      plane: rig.plane,
      threadId,
      epoch: 1,
      timers: rig.clock,
      remoteCalls: runtime.remoteCalls,
      daemonTools: new Set<string>(),
      nowIso: () => new Date(rig.clock.now()).toISOString(),
    })

    const first = await record.append({
      threadId,
      runId: rig.ids.nextRunId(),
      drafts: [
        {
          type: 'tool-dispatched',
          callId: toCallId('call-9'),
          name: 'read',
          bootId: 'boot-original',
        },
      ],
    })
    expect(first.filter((event) => event.type === 'tool-dispatched').length).toBe(1)

    let seenBootId: string | undefined
    await runInCallScope({
      scopeKey: 'test:scope',
      body: async () => {
        await record.append({
          threadId,
          runId: rig.ids.nextRunId(),
          drafts: [
            {
              type: 'tool-dispatched',
              callId: toCallId('call-9'),
              name: 'read',
              bootId: 'boot-dup',
            },
          ],
        })
        seenBootId = scopeDispatchedBootId()
      },
    })

    const dispatched = (await rig.events()).filter((event) => event.type === 'tool-dispatched')
    expect(dispatched.filter((event) => event.seq >= 2).length).toBe(1)
    expect(dispatched[0]?.bootId).toBe('boot-original')
    expect(seenBootId).toBe('boot-original')
  }, 15_000)
})
