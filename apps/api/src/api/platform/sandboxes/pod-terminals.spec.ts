import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'
import { seedUsers } from '../../../../test/session-seed'
import { endPodTerminals } from './pod-terminals'

const NOW = new Date('2026-11-19T06:00:00Z')

const v2Session = async (args: { id: string; podSessionId?: string }): Promise<void> => {
  await db.orm.v2.V2Session.create({
    id: args.id,
    userId: 'user-a',
    mainThreadId: `thr_${args.id}`,
    nextInboxId: 1,
    modelRef: 'anthropic/claude-haiku-4-5',
    modelEffort: 'medium',
    modelFast: false,
    ...(args.podSessionId === undefined ? {} : { podSessionId: args.podSessionId }),
    createdAt: NOW,
  })
}

const terminal = async (args: {
  sessionId: string
  terminalId: string
  ordinal: number
  state: 'open' | 'ended'
}): Promise<void> => {
  await db.orm.v2.V2Terminal.create({
    sessionId: args.sessionId,
    terminalId: args.terminalId,
    ordinal: args.ordinal,
    name: `Terminal ${args.ordinal}`,
    state: args.state,
    ...(args.state === 'ended' ? { endedReason: 'exited', endedAt: NOW, exitCode: 0 } : {}),
    createdAt: NOW,
  })
}

const terminalRowsOf = (sessionId: string) =>
  db.orm.v2.V2Terminal.where({ sessionId }).select('terminalId', 'state', 'endedReason').all()

describe('endPodTerminals', () => {
  useTestDatabase()

  it('ends the open terminals of every session on a pod that is gone', async () => {
    await seedUsers('user-a')
    await v2Session({ id: 'ses-root', podSessionId: 'pod-1' })
    await v2Session({ id: 'ses-peer', podSessionId: 'pod-1' })
    await v2Session({ id: 'ses-elsewhere', podSessionId: 'pod-2' })
    await terminal({ sessionId: 'ses-root', terminalId: 't1', ordinal: 1, state: 'open' })
    await terminal({ sessionId: 'ses-peer', terminalId: 't2', ordinal: 1, state: 'open' })
    await terminal({ sessionId: 'ses-root', terminalId: 't3', ordinal: 2, state: 'ended' })
    await terminal({ sessionId: 'ses-elsewhere', terminalId: 't4', ordinal: 1, state: 'open' })

    const ended = await endPodTerminals({ podSessionIds: ['pod-1'] })

    expect(ended).toBe(2)
    expect(await terminalRowsOf('ses-root')).toEqual([
      { terminalId: 't1', state: 'ended', endedReason: 'pod-slept' },
      { terminalId: 't3', state: 'ended', endedReason: 'exited' },
    ])
    expect(await terminalRowsOf('ses-peer')).toEqual([
      { terminalId: 't2', state: 'ended', endedReason: 'pod-slept' },
    ])
    expect(await terminalRowsOf('ses-elsewhere')).toEqual([
      { terminalId: 't4', state: 'open', endedReason: null },
    ])
  })

  it('ends the terminals of a root pod, named by its own session id', async () => {
    await seedUsers('user-a')
    await v2Session({ id: 'ses-solo' })
    await terminal({ sessionId: 'ses-solo', terminalId: 't1', ordinal: 1, state: 'open' })

    expect(await endPodTerminals({ podSessionIds: ['ses-solo'] })).toBe(1)
    expect(await terminalRowsOf('ses-solo')).toEqual([
      { terminalId: 't1', state: 'ended', endedReason: 'pod-slept' },
    ])
  })

  it('ignores a pod that never hosted a v2 session', async () => {
    await seedUsers('user-a')
    await v2Session({ id: 'ses-root', podSessionId: 'pod-1' })
    await terminal({ sessionId: 'ses-root', terminalId: 't1', ordinal: 1, state: 'open' })

    expect(await endPodTerminals({ podSessionIds: ['pod-elsewhere'] })).toBe(0)
    expect(await endPodTerminals({ podSessionIds: [] })).toBe(0)
    expect(await terminalRowsOf('ses-root')).toEqual([
      { terminalId: 't1', state: 'open', endedReason: null },
    ])
  })
})
