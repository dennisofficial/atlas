import { chainEvents, toRunId, toThreadId } from '@dltech/atlas-core'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { skillsChangedSchema } from '@dltech/atlas-plugin-skills/core'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { startRig, type FaultRig } from '../fault-rig'

const RIG_HOST_ID = 2_000_000_001

describe('the fault rig control plane', () => {
  const testDb = useTestDatabase()
  let rig: FaultRig

  beforeAll(async () => {
    rig = await startRig({ databaseUrl: testDb().url, redisUrl: '' })
  }, 60_000)

  afterAll(async () => {
    await rig.stop()
  })

  it('accepts a plugin event body the registered plugins declare', async () => {
    const sessionId = 'rig-plugin-events'
    const threadId = await rig.newSession({ sessionId, text: 'append a plugin event' })
    const { epoch } = await rig.plane.grant({ sessionId, hostId: RIG_HOST_ID })
    const body = skillsChangedSchema.parse({
      type: 'skills-changed',
      skills: [
        {
          name: 'video',
          description: 'Create videos programmatically',
          argumentHint: null,
          origin: 'builtin',
        },
      ],
    })

    const outcome = await rig.plane.append({
      threadId,
      epoch,
      events: chainEvents({
        threadId: toThreadId(threadId),
        runId: toRunId('rig-plugin-events'),
        epoch,
        at: new Date().toISOString(),
        bodies: [body],
        from: await rig.plane.head({ threadId }),
      }),
    })

    expect(outcome).toMatchObject({ ok: true })
  })
})
