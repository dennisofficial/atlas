import { afterEach, describe, expect, it } from 'bun:test'

import {
  EContextSlot,
  EMessageOrigin,
  toRunId,
  type EventDraft,
  type ThreadId,
} from '@dltech/atlas-core'

import { buildHarness, type AtlasHarness } from '..'
import { scriptedModel } from '../../model/testing/scripted-model'
import { createTempHome, type TempHome } from './temp-home'

const opened: { harness: AtlasHarness; temp: TempHome }[] = []

afterEach(async () => {
  for (const entry of opened.splice(0)) {
    await entry.harness.close()
    entry.temp.discard()
  }
})

const reviewDraft = (text: string): EventDraft => ({
  type: 'context-loaded',
  slot: EContextSlot.Skill,
  key: 'review',
  content: text,
})

const expander = ({ text, context }: { text: string; context: readonly EventDraft[] }) =>
  text.startsWith('/review') &&
  !context.some((draft) => draft.type === 'context-loaded' && draft.key === 'review')
    ? [reviewDraft(text)]
    : []

async function open(): Promise<{ harness: AtlasHarness; threadId: ThreadId }> {
  const temp = createTempHome()
  const harness = await buildHarness({
    home: temp.home,
    model: scriptedModel({ script: [{ text: 'a' }, { text: 'b' }, { text: 'c' }] }),
    expandContext: expander,
  })
  opened.push({ harness, temp })
  const thread = await harness.threads.create({})
  return { harness, threadId: thread.id }
}

const skillKeys = async (harness: AtlasHarness, threadId: ThreadId): Promise<string[]> =>
  (await harness.log.read({ threadId })).flatMap((event) =>
    event.type === 'context-loaded' && event.slot === EContextSlot.Skill ? [event.key] : [],
  )

describe('resume with unexpanded operator messages', () => {
  it('loads the skill once, before the turn, and not again on a second resume', async () => {
    const { harness, threadId } = await open()
    await harness.log.append({
      threadId,
      runId: toRunId('run-x'),
      drafts: [{ type: 'user-said', text: '/review now' }],
    })

    await harness.runner.resume({ threadId })
    expect(await skillKeys(harness, threadId)).toEqual(['review'])
    const types = (await harness.log.read({ threadId })).map((event) => event.type)
    expect(types.indexOf('context-loaded')).toBeLessThan(types.indexOf('assistant-said'))

    await harness.runner.resume({ threadId })
    expect(await skillKeys(harness, threadId)).toEqual(['review'])
  }, 30_000)

  it('adds nothing when the tail already carries the skill draft', async () => {
    const { harness, threadId } = await open()
    await harness.log.append({
      threadId,
      runId: toRunId('run-z'),
      drafts: [reviewDraft('/review now'), { type: 'user-said', text: '/review now' }],
    })
    await harness.runner.resume({ threadId })
    expect(await skillKeys(harness, threadId)).toEqual(['review'])
  }, 30_000)

  it('leaves answered messages and non-operator messages alone', async () => {
    const { harness, threadId } = await open()
    await harness.runner.say({ threadId, text: '/review old' })
    await harness.runner.say({ threadId, text: 'hello' })
    await harness.log.append({
      threadId,
      runId: toRunId('run-y'),
      drafts: [{ type: 'user-said', text: '/review x', via: EMessageOrigin.ParentAgent }],
    })
    await harness.runner.resume({ threadId })
    expect(await skillKeys(harness, threadId)).toEqual(['review'])
  }, 30_000)
})
