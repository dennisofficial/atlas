import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  EForkMode,
  ESubscriptionActor,
  ESubscriptionEnd,
  ESubscriptionStatus,
  type EventDraft,
} from '@dltech/atlas-core'

import { CountingIds, SteppingClock } from '../../__tests__/harness'
import { JsonlEventLog } from '../event-log'
import { SessionRegistry } from '../registry'
import { JsonlThreadStore } from '../thread-store'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const said = (text: string): EventDraft => ({ type: 'user-said', text })

const subscriptionDrafts: EventDraft[] = [
  {
    type: 'subscription-created',
    subscriptionId: 'sub-1',
    provider: 'github.pr',
    target: { repo: 'github.com/o/r', number: 1 },
    label: 'o/r#1',
    createdBy: ESubscriptionActor.Agent,
  },
  {
    type: 'subscription-changed',
    subscriptionId: 'sub-1',
    status: ESubscriptionStatus.Paused,
    by: ESubscriptionActor.Operator,
  },
  {
    type: 'subscription-ended',
    subscriptionId: 'sub-1',
    reason: ESubscriptionEnd.Unsubscribed,
    by: ESubscriptionActor.Operator,
  },
]

describe('JsonlThreadStore.fork with subscriptions', () => {
  it('starts a copy fork unsubscribed and leaves the source log whole', async () => {
    const home = await mkdtemp(join(tmpdir(), 'atlas-fork-subscriptions-'))
    directories.push(home)
    const registry = new SessionRegistry(home)
    const clock = new SteppingClock()
    const ids = new CountingIds('spec')
    const log = new JsonlEventLog(home, registry, clock, ids)
    const threads = new JsonlThreadStore(home, registry, clock, ids, log)
    const source = await threads.create({ title: 'work', workspace: '/here', repo: '/repo' })
    await log.append({
      threadId: source.id,
      runId: ids.nextRunId(),
      drafts: [said('one'), ...subscriptionDrafts, said('two')],
    })

    const copy = await threads.fork({ from: source.id, seq: 5, mode: EForkMode.Copy })

    expect((await log.readOwn({ threadId: copy.id })).map((event) => event.type)).toEqual([
      'user-said',
      'user-said',
    ])
    expect((await log.readOwn({ threadId: source.id })).map((event) => event.type)).toEqual([
      'user-said',
      'subscription-created',
      'subscription-changed',
      'subscription-ended',
      'user-said',
    ])
  })
})
