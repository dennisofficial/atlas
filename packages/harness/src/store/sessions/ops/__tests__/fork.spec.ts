import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'

import { EForkMode, toThreadId, type EventDraft } from '@dltech/atlas-core'

import { readMetaSync, sessionMetaSchema, threadMetaSchema, writeMeta } from '../../meta'
import { eventLogFile, sessionMetaFile, threadMetaFile } from '../../paths'
import { ForkSeqOutOfRange, ForkSourceMissing, forkThread } from '../fork'
import { closeOpsFixtures, openOpsFixture, openThread } from './fixture'

afterEach(async () => {
  await closeOpsFixtures()
})

const said = (text: string): EventDraft => ({ type: 'user-said', text })

const OPENING = [said('p1'), said('p2'), said('p3'), said('p4')]

describe('forkThread over the sessions store', () => {
  it('creates a session folder with a reference-fork root meta and an empty log', async () => {
    const fixture = await openOpsFixture()
    const from = await openThread({ fixture, drafts: OPENING })
    const sourceDir = await fixture.log.sessionDirFor({ threadId: from })
    const sourceMeta = readMetaSync({ file: threadMetaFile({ sessionDir: sourceDir, threadId: from }), schema: threadMetaSchema })
    if (sourceMeta === undefined) throw new Error('source meta missing in spec')
    await writeMeta({
      file: threadMetaFile({ sessionDir: sourceDir, threadId: from }),
      meta: {
        ...sourceMeta,
        workspace: '/work/repo',
        repo: 'github.com/dennisofficial/atlas',
        modelRef: 'claude-opus',
        modelEffort: 'high',
        executionLocation: 'host',
      },
    })

    const forked = await forkThread({
      home: fixture.home,
      registry: fixture.registry,
      ids: fixture.ids,
      clock: fixture.clock,
      from,
      seq: 2,
      title: 'forked work',
    })

    expect(existsSync(eventLogFile({ sessionDir: forked.sessionDir, threadId: forked.threadId }))).toBe(true)
    expect(readFileSync(eventLogFile({ sessionDir: forked.sessionDir, threadId: forked.threadId }), 'utf8')).toBe('')

    expect(forked.meta).toMatchObject({
      id: forked.threadId,
      title: 'forked work',
      head: 0,
      parentThreadId: from,
      forkSeq: 2,
      forkMode: EForkMode.Reference,
      workspace: '/work/repo',
      repo: 'github.com/dennisofficial/atlas',
      modelRef: 'claude-opus',
      modelEffort: 'high',
      executionLocation: 'host',
    })

    const sessionMeta = readMetaSync({
      file: sessionMetaFile({ sessionDir: forked.sessionDir }),
      schema: sessionMetaSchema,
    })
    expect(sessionMeta).toMatchObject({
      format: 1,
      id: forked.threadId,
      title: 'forked work',
      home: 'host',
      repo: 'github.com/dennisofficial/atlas',
      workspace: '/work/repo',
    })
  })

  it('reads the parent prefix through the fork and appends above it', async () => {
    const fixture = await openOpsFixture()
    const from = await openThread({ fixture, drafts: OPENING })

    const forked = await forkThread({
      home: fixture.home,
      registry: fixture.registry,
      ids: fixture.ids,
      clock: fixture.clock,
      from,
      seq: 2,
    })

    const prefix = await fixture.log.read({ threadId: forked.threadId })
    expect(prefix.map((event) => (event.type === 'user-said' ? event.text : event.type))).toEqual(['p1', 'p2'])

    await fixture.log.append({
      threadId: forked.threadId,
      runId: fixture.ids.nextRunId(),
      drafts: [said('f1')],
    })
    const composed = await fixture.log.read({ threadId: forked.threadId })
    expect(composed.map((event) => (event.type === 'user-said' ? event.text : event.type))).toEqual(['p1', 'p2', 'f1'])
  })

  it('refuses a source the store has never heard of', async () => {
    const fixture = await openOpsFixture()

    await expect(
      forkThread({
        home: fixture.home,
        registry: fixture.registry,
        ids: fixture.ids,
        clock: fixture.clock,
        from: toThreadId('brn_ghost'),
        seq: 0,
      }),
    ).rejects.toBeInstanceOf(ForkSourceMissing)
  })

  it('refuses a fork point past the source head', async () => {
    const fixture = await openOpsFixture()
    const from = await openThread({ fixture, drafts: OPENING })

    await expect(
      forkThread({
        home: fixture.home,
        registry: fixture.registry,
        ids: fixture.ids,
        clock: fixture.clock,
        from,
        seq: 9,
      }),
    ).rejects.toBeInstanceOf(ForkSeqOutOfRange)
  })
})
