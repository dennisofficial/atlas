import { useTestDatabase } from '@dltech/atlas-db/testing'
import { operatorAnswerPayloadSchema } from '@dltech/atlas-plugin-operator/core'
import { describe, expect, it } from 'bun:test'

import { OperatorAnswerService } from '../answer-service'
import type { Posted } from './fixtures'
import { CALL, cipher, registryOf, seedSession, VALUE } from './fixtures'

const testDb = useTestDatabase()

describe('OperatorAnswerService', () => {
  const answerOf = (args: { db: Parameters<typeof registryOf>[0]['db']; posted?: Posted[] }) => {
    const registry = registryOf(args)
    return {
      posted: args.posted ?? [],
      service: new OperatorAnswerService({ registry }),
    }
  }

  it("answers 200 straight away for the owner's session, with the value sealed in the inbox", async () => {
    const { db } = testDb()
    await seedSession(db, { id: 'ses_1', userId: 'user-1' })
    const posted: Posted[] = []
    const { service } = answerOf({ db, posted })

    const refused = await service.answer({
      userId: 'user-2',
      body: { sessionId: 'ses_1', callId: CALL, value: VALUE },
    })
    expect(refused.status).toBe(404)

    const answered = await service.answer({
      userId: 'user-1',
      body: { sessionId: 'ses_1', callId: CALL, value: VALUE },
    })

    expect(answered.status).toBe(200)
    const stored = operatorAnswerPayloadSchema.parse(JSON.parse(posted[0]?.payload ?? 'null'))
    expect(stored.callId).toBe(CALL)
    expect('sealedValue' in stored ? cipher.decrypt(stored.sealedValue) : undefined).toBe(VALUE)
    expect(posted[0]?.payload).not.toContain(VALUE)
  })

  it('stores a cancel with no value at all', async () => {
    const { db } = testDb()
    await seedSession(db, { id: 'ses_1', userId: 'user-1' })
    const posted: Posted[] = []
    const { service } = answerOf({ db, posted })

    const answered = await service.answer({
      userId: 'user-1',
      body: { sessionId: 'ses_1', callId: CALL, cancel: true },
    })

    expect(answered.status).toBe(200)
    expect(posted[0]?.payload).toBe(JSON.stringify({ callId: CALL, cancel: true }))
  })
})
