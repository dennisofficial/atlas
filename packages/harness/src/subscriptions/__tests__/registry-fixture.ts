import {
  ESubscriptionActor,
  toRunId,
  toThreadId,
  type EventDraft,
  type IdPort,
  type JsonValue,
  type ThreadId,
} from '@dltech/atlas-core'

import { SubscriptionRegistry } from '../registry'
import type { SubscriptionOccurrence, SubscriptionProvider } from '../provider'
import type { ThreadKinds } from '../thread-owner'
import { FakeClock } from './fake-schedule'
import { MemoryLog } from './memory-log'

export const MAIN = toThreadId('main')
export const CHILD = toThreadId('child')

export class FakeProvider {
  readonly started: string[] = []
  readonly stopped: string[] = []
  private readonly emitters = new Map<string, (occurrence: SubscriptionOccurrence) => void>()

  readonly provider: SubscriptionProvider = {
    kind: 'fake.pr',
    summary: 'A fake pull request',
    targetHint: 'owner/repo#number',
    resolve: async ({ input }) =>
      input.startsWith('bad')
        ? { error: `cannot resolve "${input}"` }
        : { target: { input } satisfies JsonValue, label: `fake ${input}` },
    start: ({ subscription, emit }) => {
      this.started.push(subscription.id)
      this.emitters.set(subscription.id, emit)
      return () => {
        this.stopped.push(subscription.id)
        this.emitters.delete(subscription.id)
      }
    },
  }

  emit(args: { id: string; occurrence: SubscriptionOccurrence }): void {
    this.emitters.get(args.id)?.(args.occurrence)
  }
}

export const note = (text: string): EventDraft => ({ type: 'user-said', text })

export function registryOf(args: { parents?: ReadonlyMap<ThreadId, ThreadId> | undefined } = {}) {
  const log = new MemoryLog()
  const clock = new FakeClock()
  const fake = new FakeProvider()
  const warnings: string[] = []
  let counter = 0
  const ids: IdPort = {
    nextThreadId: () => toThreadId('thread'),
    nextRunId: () => toRunId(`run-${counter++}`),
    nextEventId: () => {
      throw new Error('unused')
    },
    nextCallId: () => {
      throw new Error('unused')
    },
  }
  const owners: ThreadKinds = {
    ownerOf: async ({ threadId }) => args.parents?.get(threadId) ?? threadId,
  }
  let next = 0
  const registry = new SubscriptionRegistry({
    log,
    ids,
    owners,
    providers: [fake.provider],
    now: clock.now,
    schedule: clock.schedule,
    warn: (message) => warnings.push(message),
    newId: () => `sub-${++next}`,
  })
  return { registry, log, clock, fake, warnings }
}

export const subscribeTo = (
  fixture: ReturnType<typeof registryOf>,
  input: string,
  threadId: ThreadId = MAIN,
  expiresAt?: string,
) =>
  fixture.registry.subscribe({
    threadId,
    provider: 'fake.pr',
    input,
    projectDirectory: '/repo',
    by: ESubscriptionActor.Agent,
    expiresAt,
  })
