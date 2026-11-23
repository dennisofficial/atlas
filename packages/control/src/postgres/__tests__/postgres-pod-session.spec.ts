import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'

import { UnknownThreadError } from '../../errors'
import { podSessionIdOfThreadIn } from '../postgres-pod-session'

const AT = new Date('2026-11-23T20:00:00.000Z')

const seedSession = async (args: { id: string; podSessionId: string | null }): Promise<void> => {
  await db.orm.v2.V2Session.create({
    id: args.id,
    userId: 'usr_pod',
    mainThreadId: `thr_main_${args.id}`,
    nextInboxId: 1,
    createdAt: AT,
    modelRef: 'anthropic/claude-haiku-4-5',
    modelEffort: 'medium',
    modelFast: false,
    podSessionId: args.podSessionId,
  })
}

const seedThread = async (args: { id: string; sessionId: string }): Promise<void> => {
  await db.orm.v2.V2Thread.create({
    id: args.id,
    sessionId: args.sessionId,
    headSeq: 0,
    headHash: '',
    visibility: 'visible',
    createdAt: AT,
  })
}

const podOf = (threadId: string) => db.transaction((tx) => podSessionIdOfThreadIn({ tx, threadId }))

describe('podSessionIdOfThreadIn', () => {
  useTestDatabase()

  it('answers the session itself for the main thread of a session that owns its pod', async () => {
    await seedSession({ id: 'ses_own', podSessionId: null })

    expect(await podOf('thr_main_ses_own')).toBe('ses_own')
  })

  it('answers the shared pod for a sub-thread of a teammate session', async () => {
    await seedSession({ id: 'ses_parent', podSessionId: null })
    await seedSession({ id: 'ses_mate', podSessionId: 'ses_parent' })
    await seedThread({ id: 'thr_sub', sessionId: 'ses_mate' })

    expect(await podOf('thr_main_ses_mate')).toBe('ses_parent')
    expect(await podOf('thr_sub')).toBe('ses_parent')
  })

  it('refuses a thread no v2 session owns', async () => {
    await expect(podOf('thr_missing')).rejects.toBeInstanceOf(UnknownThreadError)
  })
})
