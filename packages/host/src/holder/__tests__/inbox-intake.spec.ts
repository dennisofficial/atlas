import { describe, expect, it } from 'bun:test'

import {
  composeCommands,
  defineCommand,
  EClientAction,
  ECommandGroup,
  ECommandRunsIn,
  type CommandHandler,
  type CommandRegistry,
  type ControlCommandHandler,
} from '@dltech/atlas-commands'
import type { ControlPlane } from '@dltech/atlas-control'
import { resize } from '@dltech/atlas-native-commands'
import {
  type InputMessage,
  EContextSlot,
  EInputConsumed,
  EMessageOrigin,
  EServiceStatus,
  ESubscriptionActor,
  ESubscriptionEnd,
  initialLoopState,
  toRunId,
  toThreadId,
  type EventBody,
  type EventDraft,
  type InboxEntry,
} from '@dltech/atlas-core'
import { z } from 'zod'

import type { PodSlash } from '@dltech/atlas-plugin-sdk'

import type { CommandHandlers, ControlHandlers } from '../command-intake'
import { InboxIntake } from '../inbox-intake'
import { EIntakeScope } from '../intake-scope'
import type { AppendBody, SessionRecord } from '../record/record-adapter'
import { eventsOf } from './operator-answer-rig'

const NOW = Date.parse('2026-11-08T12:00:00.000Z')
const HOUR_MS = 60 * 60 * 1000

const entry = (inboxId: number, payload?: unknown, kind = 'message'): InboxEntry => ({
  sessionId: 'session-1',
  inboxId,
  kind,
  payload: JSON.stringify(payload ?? { text: `m${inboxId}` }),
  postedAt: new Date(NOW).toISOString(),
  consumedSeq: null,
  threadId: null,
  senderSessionId: null,
})

const withdrawOf = (inboxId: number, targetInboxId: number): InboxEntry =>
  entry(inboxId, { targetInboxId }, 'withdraw')

type RigOptions = {
  scope?: EIntakeScope
  commands?: boolean
  registry?: CommandRegistry
  handlers?: CommandHandlers
  controlHandlers?: ControlHandlers
  slash?: PodSlash
  renames?: { sessionId: string; title: string }[]
  now?: number
  source?: (args: { afterId: number; limit: number }) => Promise<InboxEntry[]>
}

const rigOf = (entries: readonly InboxEntry[], options: RigOptions = {}) => {
  const appended: AppendBody[] = []
  const appends: AppendBody[][] = []
  const logged = new Set<number>()
  const warnings: string[] = []
  const infos: string[] = []
  const record = {
    append: async ({ drafts }: { drafts: readonly AppendBody[] }) => {
      appends.push([...drafts])
      appended.push(...drafts)
      for (const draft of drafts) {
        if (draft.type === 'input-posted') logged.add(draft.inboxId)
      }
    },
    eventCache: () => ({
      eventsAfter: () => eventsOf(appended as unknown as EventDraft[]),
      loopEventsAfter: () => eventsOf(appended as unknown as EventDraft[]),
    }),
    loopState: async () => initialLoopState(),
  } as unknown as SessionRecord
  const source =
    options.source ??
    (async ({ afterId, limit }: { afterId: number; limit: number }) =>
      entries.filter((kept) => kept.inboxId > afterId && !logged.has(kept.inboxId)).slice(0, limit))
  const intake = new InboxIntake({
    plane: {
      readInbox: source,
      readInboxEntry: async ({ inboxId }: { inboxId: number }) =>
        entries.find((kept) => kept.inboxId === inboxId),
      renameSession: async (params: { sessionId: string; title: string }) => {
        options.renames?.push(params)
      },
      endTerminals: async () => 0,
    } as unknown as ControlPlane,
    sessionId: 'session-1',
    record,
    scope: options.scope ?? EIntakeScope.Main,
    threadId: toThreadId('thread-1'),
    runId: () => toRunId('run-1'),
    ...(options.registry === undefined ? {} : { commands: options.registry }),
    ...(options.commands === true ? { commands: composeCommands([]) } : {}),
    ...(options.handlers === undefined ? {} : { handlers: options.handlers }),
    ...(options.controlHandlers === undefined ? {} : { controlHandlers: options.controlHandlers }),
    ...(options.slash === undefined ? {} : { slash: options.slash }),
    now: () => options.now ?? NOW,
    log: {
      warn: (line: { message: string }) => warnings.push(line.message),
      info: (line: { message: string }) => infos.push(line.message),
      error: () => {},
    } as never,
  })
  const appendExternally = async (drafts: readonly AppendBody[]) => {
    await record.append({ threadId: toThreadId('thread-1'), runId: toRunId('run-1'), drafts })
  }
  return { intake, appended, appends, warnings, infos, logged, appendExternally }
}

const posted = (inboxId: number, message?: object): AppendBody => ({
  type: 'input-posted',
  inboxId,
  kind: 'message',
  postedAt: new Date(NOW).toISOString(),
  ...(message === undefined ? {} : { message: message as InputMessage }),
})

const postedCommand = (inboxId: number, kind: string): AppendBody => ({
  type: 'input-posted',
  inboxId,
  kind,
  postedAt: new Date(NOW).toISOString(),
})

const said = (inboxId: number, extra: Record<string, unknown> = {}): AppendBody => ({
  type: 'user-said',
  text: `m${inboxId}`,
  requestId: `inbox:${inboxId}`,
  inboxId,
  ...extra,
})

describe('InboxIntake idle send', () => {
  it('posts and says a message in one append', async () => {
    const rig = rigOf([entry(1)])
    const drain = await rig.intake.prepare()
    expect(drain).toEqual({ drafts: [], wakesTurn: true })
    expect(rig.appends).toEqual([[posted(1, { text: 'm1' }), said(1)]])
  })

  it('carries the clientId on both events', async () => {
    const rig = rigOf([entry(2, { text: 'm2', clientId: 'c2' })])
    await rig.intake.prepare()
    expect(rig.appends).toEqual([
      [posted(2, { text: 'm2', clientId: 'c2' }), said(2, { clientId: 'c2' })],
    ])
  })

  it('carries stored images as attachments', async () => {
    const media = [
      {
        media: {
          hash: 'a'.repeat(64),
          mediaType: 'image/png' as const,
          size: 10,
          width: 2,
          height: 3,
        },
        source: 'shot.png',
      },
    ]
    const rig = rigOf([entry(5, { text: '', media })])
    const drain = await rig.intake.prepare()
    const attachment = {
      id: `media:0:${'a'.repeat(64)}`,
      name: 'shot.png',
      mediaType: 'image/png',
      size: 10,
      source: 'shot.png',
      content: { store: 'media', hash: 'a'.repeat(64) },
      image: { width: 2, height: 3 },
    }
    expect(drain.wakesTurn).toBe(true)
    expect(rig.appends).toEqual([
      [
        posted(5, { text: '', attachments: [attachment] }),
        said(5, { text: '', attachments: [attachment] }),
      ],
    ])
  })

  it('carries uploads as attachments', async () => {
    const uploads = [
      {
        uploadId: '11111111-1111-4111-8111-111111111111',
        pathname: 'composer-uploads/user-a/11111111-1111-4111-8111-111111111111/notes.txt',
        name: 'notes.txt',
        size: 7,
        mediaType: 'text/plain',
      },
    ]
    const rig = rigOf([entry(6, { text: 'see file', uploads })])
    await rig.intake.prepare()
    const attachment = {
      id: uploads[0]!.uploadId,
      name: 'notes.txt',
      mediaType: 'text/plain',
      size: 7,
      content: {
        store: 'upload' as const,
        uploadId: uploads[0]!.uploadId,
        pathname: uploads[0]!.pathname,
      },
    }
    expect(rig.appends).toEqual([
      [
        posted(6, { text: 'see file', attachments: [attachment] }),
        said(6, { text: 'see file', attachments: [attachment] }),
      ],
    ])
  })

  it('marks a peer session message as a peer agent on both events', async () => {
    const rig = rigOf([{ ...entry(9), senderSessionId: 'ses_2' }])
    await rig.intake.prepare()
    const peer = { text: 'm9', sender: { session: 'ses_2' }, via: EMessageOrigin.PeerAgent }
    expect(rig.appends).toEqual([[posted(9, peer), said(9, peer)]])
  })

  it('marks an origin in the payload as that origin', async () => {
    const rig = rigOf([entry(11, { text: 'm11', via: 'child-agent' })])
    await rig.intake.prepare()
    expect(rig.appends).toEqual([
      [
        posted(11, { text: 'm11', via: EMessageOrigin.ChildAgent }),
        said(11, { text: 'm11', via: EMessageOrigin.ChildAgent }),
      ],
    ])
  })

  it('refuses an unreadable message and hands back its text, clientId and attachments', async () => {
    const attachment = {
      id: 'a1',
      name: 'notes.txt',
      mediaType: 'text/plain',
      size: 7,
      content: {
        store: 'upload' as const,
        uploadId: '11111111-1111-4111-8111-111111111111',
        pathname: 'composer-uploads/notes.txt',
      },
    }
    const misplaced = entry(12, {
      text: 'a steer',
      clientId: 'c12',
      attachments: [attachment],
      sender: { session: 'ses_2' },
    })
    const rig = rigOf([misplaced])
    const drain = await rig.intake.prepare()
    expect(drain.wakesTurn).toBe(false)
    expect(rig.appends).toEqual([
      [
        {
          type: 'input-refused',
          inboxId: 12,
          reason: 'unreadable message',
          clientId: 'c12',
          message: { text: 'a steer', attachments: [attachment] },
        },
      ],
    ])
  })
})

const ping = defineCommand({
  spec: {
    name: 'ping',
    summary: 'records a fact',
    group: ECommandGroup.Session,
    args: z.strictObject({ word: z.string() }),
    runsIn: ECommandRunsIn.Host,
  },
})

const pingHandler: CommandHandler<unknown> = async () => ({ kind: 'done' })

describe('InboxIntake logStaged', () => {
  it('logs a posted message and a resolvable command but no user-said', async () => {
    const rig = rigOf(
      [
        entry(1),
        entry(2, { word: 'x' }, 'command:ping'),
        entry(3, {}, 'retry'),
        entry(4, {}, 'stop'),
      ],
      {
        registry: composeCommands([ping]),
        handlers: new Map([[ping.inboxKind, pingHandler]]),
      },
    )
    await rig.intake.logStaged()
    expect(rig.appends).toEqual([[posted(1, { text: 'm1' }), postedCommand(2, 'command:ping')]])
  })

  it('leaves a command it cannot resolve staged when there is no registry', async () => {
    const rig = rigOf([entry(7, {}, 'command:ghost'), entry(8, {}, 'command:ping')])
    await rig.intake.logStaged()
    expect(rig.appends).toEqual([])
  })

  it('leaves a command it cannot resolve staged when the registry lacks the kind', async () => {
    const rig = rigOf([entry(7, {}, 'command:ghost')], { registry: composeCommands([ping]) })
    await rig.intake.logStaged()
    expect(rig.appends).toEqual([])
  })

  it('logs a command whose kind this host knows but has no handler', async () => {
    const rig = rigOf([entry(8, {}, 'command:ping')], {
      registry: composeCommands([ping]),
      handlers: new Map(),
    })
    await rig.intake.logStaged()
    expect(rig.appends).toEqual([[postedCommand(8, 'command:ping')]])
  })

  it('leaves an over-age unresolvable command for the prepare that discards it', async () => {
    const old = {
      ...entry(7, {}, 'command:ghost'),
      postedAt: new Date(NOW - 2 * HOUR_MS).toISOString(),
    }
    const rig = rigOf([old], { commands: true })
    await rig.intake.logStaged()
    expect(rig.appends).toEqual([])
    await rig.intake.prepare()
    expect(rig.appends).toEqual([
      [{ type: 'input-consumed', inboxId: 7, consumed: EInputConsumed.Discarded }],
    ])
  })

  it('posts and withdraws a still-staged target in one append', async () => {
    const rig = rigOf([entry(1), withdrawOf(2, 1)])
    await rig.intake.logStaged()
    expect(rig.appends).toEqual([
      [posted(1, { text: 'm1' }), { type: 'input-withdrawn', inboxId: 1, requestInboxId: 2 }],
    ])
  })

  it('keeps a record staged mid-turn and logs its event once at the drain, waking no turn', async () => {
    const ended: EventBody = {
      type: 'subscription-ended',
      subscriptionId: 'sub-1',
      reason: ESubscriptionEnd.Unsubscribed,
      by: ESubscriptionActor.Operator,
    }
    const record = entry(5, { event: ended }, 'record')
    const rig = rigOf([record])
    await rig.intake.logStaged()
    expect(rig.appends).toEqual([
      [
        {
          type: 'input-posted',
          inboxId: 5,
          kind: 'record',
          postedAt: record.postedAt,
          event: ended,
        },
      ],
    ])
    const drain = await rig.intake.prepare()
    const bodies = rig.appended.filter((draft) => draft.type === 'subscription-ended')
    expect(bodies).toEqual([ended])
    expect(drain.wakesTurn).toBe(false)
  })

  it('logs a mid-turn send as input-posted, then says it in a separate commit at the drain', async () => {
    const rig = rigOf([entry(1)])
    await rig.intake.logStaged()
    expect(rig.appends).toEqual([[posted(1, { text: 'm1' })]])
    const drain = await rig.intake.prepare()
    expect(rig.appends).toEqual([[posted(1, { text: 'm1' })], [said(1)]])
    expect(drain.wakesTurn).toBe(true)
  })
})

describe('InboxIntake commands this host cannot run', () => {
  it('refuses a command whose kind this host knows but has no handler', async () => {
    const rig = rigOf([entry(7, {}, 'command:ping')], {
      registry: composeCommands([ping]),
      handlers: new Map(),
    })
    const drain = await rig.intake.prepare()
    expect(drain).toEqual({ drafts: [], wakesTurn: false })
    expect(rig.appended.filter((draft) => draft.type === 'input-refused')).toEqual([
      { type: 'input-refused', inboxId: 7, reason: '/ping cannot run on this host' },
    ])
  })

  it('consumes the entry before it refuses it', async () => {
    const rig = rigOf([entry(7, {}, 'command:ping')], {
      registry: composeCommands([ping]),
      handlers: new Map(),
    })
    await rig.intake.prepare()
    const types = rig.appended.map((draft) => draft.type)
    expect(types.indexOf('input-consumed')).toBeLessThan(types.indexOf('input-refused'))
  })
})

describe('InboxIntake withdraw', () => {
  it('posts and withdraws a still-staged target in one commit, never saying it', async () => {
    const rig = rigOf([entry(1), withdrawOf(2, 1), entry(3)])
    const drain = await rig.intake.prepare()
    expect(rig.appends).toEqual([
      [posted(1, { text: 'm1' }), { type: 'input-withdrawn', inboxId: 1, requestInboxId: 2 }],
      [posted(3, { text: 'm3' }), said(3)],
    ])
    expect(drain.wakesTurn).toBe(true)
  })

  it('wakes no turn for a withdraw of the only staged message', async () => {
    const rig = rigOf([entry(1), withdrawOf(2, 1)])
    const drain = await rig.intake.prepare()
    expect(drain).toEqual({ drafts: [], wakesTurn: false })
    expect(rig.appended.some((draft) => draft.type === 'user-said')).toBe(false)
  })

  it('withdraws a target that is posted but not said', async () => {
    const rig = rigOf([withdrawOf(2, 1)])
    rig.appended.push(posted(1))
    await rig.intake.prepare()
    expect(rig.appends).toEqual([[{ type: 'input-withdrawn', inboxId: 1, requestInboxId: 2 }]])
  })

  it('refuses a withdraw of a message that already went to the thread', async () => {
    const rig = rigOf([withdrawOf(2, 1)])
    rig.appended.push(posted(1), said(1))
    await rig.intake.prepare()
    expect(rig.appends).toEqual([
      [
        {
          type: 'input-refused',
          inboxId: 2,
          targetInboxId: 1,
          reason: 'already-sent',
        },
      ],
    ])
  })

  it('refuses an unreadable withdraw payload', async () => {
    const rig = rigOf([{ ...entry(2), kind: 'withdraw', payload: 'nope' }])
    await rig.intake.prepare()
    expect(rig.appends).toEqual([
      [{ type: 'input-refused', inboxId: 2, reason: 'unreadable withdraw' }],
    ])
  })
})

describe('InboxIntake retry and unknown entries', () => {
  it('consumes a retry as discarded, drafts nothing and does not wake a turn', async () => {
    const rig = rigOf([entry(3, {}, 'retry')])
    const drain = await rig.intake.prepare()
    expect(drain).toEqual({ drafts: [], wakesTurn: false })
    expect(rig.appends).toEqual([
      [{ type: 'input-consumed', inboxId: 3, consumed: EInputConsumed.Discarded }],
    ])
    expect(rig.warnings).toEqual([])
  })

  it('still says the message that arrived alongside the retry', async () => {
    const rig = rigOf([entry(1, {}, 'retry'), entry(2)])
    const drain = await rig.intake.prepare()
    expect(drain.wakesTurn).toBe(true)
    expect(rig.appends.at(-1)).toEqual([posted(2, { text: 'm2' }), said(2)])
  })

  it('rejects when the inbox read fails instead of draining nothing', async () => {
    const intake = rigOf([], {
      source: async () => {
        throw new Error('inbox read blew up')
      },
    }).intake
    await expect(intake.prepare()).rejects.toThrow('inbox read blew up')
  })

  it('says the message on the retry after a failed read', async () => {
    let calls = 0
    const rig = rigOf([entry(1)], {
      source: async () => {
        calls += 1
        if (calls === 1) throw new Error('blip')
        return [entry(1)]
      },
    })
    await expect(rig.intake.prepare()).rejects.toThrow('blip')
    expect((await rig.intake.prepare()).wakesTurn).toBe(true)
    expect(rig.appends).toEqual([[posted(1, { text: 'm1' }), said(1)]])
  })

  it('consumes a non-command unknown kind as discarded immediately', async () => {
    const rig = rigOf([entry(8, {}, 'mystery')], { commands: true })
    const drain = await rig.intake.prepare()
    expect(drain).toEqual({ drafts: [], wakesTurn: false })
    expect(rig.appends).toEqual([
      [{ type: 'input-consumed', inboxId: 8, consumed: EInputConsumed.Discarded }],
    ])
    expect(rig.warnings).toHaveLength(1)
  })
})

describe('InboxIntake unresolvable commands', () => {
  for (const commands of [true, false]) {
    const label = commands ? 'a registry without the kind' : 'no registry'
    const ghost = (overrides: Partial<InboxEntry> = {}): InboxEntry => ({
      ...entry(7, {}, 'command:ghost'),
      ...overrides,
    })

    it(`leaves a young command with ${label}`, async () => {
      const rig = rigOf([ghost()], { commands })
      const drain = await rig.intake.prepare()
      expect(drain).toEqual({ drafts: [], wakesTurn: false })
      expect(rig.appends).toEqual([])
      expect(rig.warnings).toEqual([])
      expect(rig.infos).toHaveLength(1)
    })

    it(`discards a command older than an hour with ${label}`, async () => {
      const rig = rigOf([ghost({ postedAt: new Date(NOW - 2 * HOUR_MS).toISOString() })], {
        commands,
      })
      await rig.intake.prepare()
      expect(rig.appends).toEqual([
        [{ type: 'input-consumed', inboxId: 7, consumed: EInputConsumed.Discarded }],
      ])
      expect(rig.warnings).toHaveLength(1)
    })
  }

  it('keeps a command exactly at the age bound and discards it just past', async () => {
    const at = (age: number) => ({
      ...entry(7, {}, 'command:ghost'),
      postedAt: new Date(NOW - age).toISOString(),
    })
    expect((await rigOf([at(HOUR_MS)], { commands: true }).intake.prepare()).wakesTurn).toBe(false)
    const past = rigOf([at(HOUR_MS + 1)], { commands: true })
    await past.intake.prepare()
    expect(past.appends).toHaveLength(1)
  })

  it('discards a command whose postedAt does not parse', async () => {
    const rig = rigOf([{ ...entry(7, {}, 'command:ghost'), postedAt: 'not a date' }], {
      commands: true,
    })
    await rig.intake.prepare()
    expect(rig.appends).toHaveLength(1)
  })

  it('still says a message behind more than one page of left commands', async () => {
    const left = Array.from({ length: 101 }, (_, index) => ({
      ...entry(index + 1, {}, 'command:ghost'),
    }))
    const all = [...left, entry(102)]
    const reads: number[] = []
    const rig = rigOf(all, {
      source: async ({ afterId, limit }) => {
        reads.push(afterId)
        return all.filter((candidate) => candidate.inboxId > afterId).slice(0, limit)
      },
    })
    const drain = await rig.intake.prepare()
    expect(reads).toEqual([0, 100])
    expect(drain.wakesTurn).toBe(true)
    expect(rig.appends.at(-1)).toEqual([posted(102, { text: 'm102' }), said(102)])
  })

  it('stops reading after ten pages', async () => {
    let reads = 0
    const rig = rigOf([], {
      source: async ({ afterId }) => {
        reads += 1
        return Array.from({ length: 100 }, (_, index) =>
          entry(afterId + index + 1, {}, 'command:ghost'),
        )
      },
    })
    await rig.intake.prepare()
    expect(reads).toBe(10)
  })
})

describe('InboxIntake already-logged messages', () => {
  it('says a message already posted in the log without posting it again', async () => {
    const rig = rigOf([], { source: async () => [entry(4)] })
    rig.appended.push(posted(4, { text: 'm4' }))
    const drain = await rig.intake.prepare()
    expect(rig.appends).toEqual([[said(4)]])
    expect(drain.wakesTurn).toBe(true)
  })

  it('posts a message once when logging it and draining it race', async () => {
    const rig = rigOf([entry(1)])
    await Promise.all([rig.intake.logStaged(), rig.intake.prepare()])
    const posts = rig.appended.filter(
      (draft) => draft.type === 'input-posted' && draft.inboxId === 1,
    )
    expect(posts).toHaveLength(1)
    expect(rig.appended.filter((draft) => draft.type === 'user-said')).toHaveLength(1)
  })

  it('says pending messages in queue order, not in the order the staging read returned', async () => {
    const rig = rigOf([], { source: async () => [entry(4)] })
    rig.appended.push(posted(3, { text: 'm3' }), posted(4, { text: 'm4' }))
    await rig.intake.prepare()
    expect(rig.appends).toEqual([[said(3)], [said(4)]])
  })

  it('drains an unlogged message ahead of a logged one that arrived later', async () => {
    const rig = rigOf([entry(3)], { source: async () => [entry(3)] })
    rig.appended.push(posted(4, { text: 'm4' }))
    await rig.intake.prepare()
    expect(rig.appends).toEqual([[posted(3, { text: 'm3' }), said(3)], [said(4)]])
  })
})

describe('InboxIntake staged logging against the drain', () => {
  it('logs a staged message alone while no drain can happen', async () => {
    const rig = rigOf([entry(1)])
    await rig.intake.logStaged({ willDrain: () => false })
    expect(rig.appends).toEqual([[posted(1, { text: 'm1' })]])
  })

  it('keeps a child agent origin when a message logged mid-turn is drained', async () => {
    const rig = rigOf([entry(1, { text: 'done', via: 'child-agent' })])
    await rig.intake.logStaged({ willDrain: () => false })
    await rig.intake.prepare()
    expect(rig.appends).toEqual([
      [posted(1, { text: 'done', via: EMessageOrigin.ChildAgent })],
      [said(1, { text: 'done', via: EMessageOrigin.ChildAgent })],
    ])
  })

  it('logs nothing alone once a drain is due, so the idle drain is one commit', async () => {
    const rig = rigOf([entry(1)])
    await rig.intake.logStaged({ willDrain: () => true })
    expect(rig.appends).toEqual([])
    const drain = await rig.intake.prepare()
    expect(rig.appends).toEqual([[posted(1, { text: 'm1' }), said(1)]])
    expect(drain.wakesTurn).toBe(true)
  })
})

describe('InboxIntake hasQueued during a concurrent stage', () => {
  it('counts a message another writer stages while its inbox read is in flight', async () => {
    const rows = [entry(1)]
    let entered: () => void = () => undefined
    const reading = new Promise<void>((resolve) => {
      entered = resolve
    })
    let release: () => void = () => undefined
    const gated = new Promise<void>((resolve) => {
      release = resolve
    })
    let reads = 0
    const rig = rigOf(rows, {
      scope: EIntakeScope.Child,
      source: async ({ afterId, limit }) => {
        reads += 1
        if (reads === 1) {
          entered()
          await gated
        }
        return rows
          .filter((kept) => kept.inboxId > afterId && !rig.logged.has(kept.inboxId))
          .slice(0, limit)
      },
    })
    const queued = rig.intake.hasQueued()
    await reading
    await rig.appendExternally([posted(1, { text: 'm1' })])
    release()
    expect(await queued).toBe(true)
  })
})

describe('InboxIntake withdraw across a staged message', () => {
  it('never says a message that a withdraw in the same drain cancelled', async () => {
    const rows = [entry(1, { text: 'hello' })]
    const rig = rigOf(rows)
    await rig.intake.logStaged({ willDrain: () => false })
    rows.push(withdrawOf(2, 1))
    const drain = await rig.intake.prepare()
    expect(drain).toEqual({ drafts: [], wakesTurn: false })
    expect(rig.appended.some((draft) => draft.type === 'user-said')).toBe(false)
    expect(rig.appends).toEqual([
      [posted(1, { text: 'hello' })],
      [{ type: 'input-withdrawn', inboxId: 1, requestInboxId: 2 }],
    ])
  })
})

describe('InboxIntake in the child scope', () => {
  it('leaves a main-only row for the main thread in staging and in the drain', async () => {
    const rows = [
      withdrawOf(1, 9),
      entry(2, {}, 'operator-answer'),
      entry(3, {}, 'retry'),
      entry(4, {}, 'stop'),
      entry(5, {}, 'command:ping'),
    ]
    const rig = rigOf(rows, { scope: EIntakeScope.Child, commands: true })
    await rig.intake.logStaged({ willDrain: () => false })
    expect(rig.appends).toEqual([])
    const drain = await rig.intake.prepare()
    expect(drain).toEqual({ drafts: [], wakesTurn: false })
    expect(rig.appends).toEqual([])
  })
})

const renameArgs = z.strictObject({ name: z.string().trim().min(1) })

const renameCommand = defineCommand({
  spec: {
    name: 'rename',
    summary: 'Rename this session',
    group: ECommandGroup.Session,
    argumentHint: '<name>',
    args: renameArgs,
    runsIn: ECommandRunsIn.Control,
    fromText: (argumentText) =>
      argumentText === ''
        ? { ok: false, reason: '/rename needs a name' }
        : { ok: true, args: { name: argumentText } },
  },
})

const modelCommand = defineCommand({
  spec: {
    name: 'model',
    summary: 'Pick a model',
    group: ECommandGroup.Session,
    args: z.strictObject({}),
    runsIn: ECommandRunsIn.Client,
    opens: EClientAction.ModelPicker,
  },
})

const renameHandler: ControlCommandHandler<ControlPlane, unknown> = async ({
  plane,
  sessionId,
  args,
}) => {
  const { name } = renameArgs.parse(args)
  await plane.renameSession({ sessionId, title: name })
}

describe('InboxIntake typed text commands', () => {
  const registry = composeCommands([renameCommand, modelCommand])

  it('posts, consumes and runs a typed control command without saying it', async () => {
    const renames: { sessionId: string; title: string }[] = []
    const rig = rigOf([entry(1, { text: '/rename bench' })], {
      registry,
      controlHandlers: new Map([['rename', renameHandler]]),
      renames,
    })
    const drain = await rig.intake.prepare()
    expect(drain).toEqual({ drafts: [], wakesTurn: false })
    expect(rig.appends).toEqual([
      [posted(1, { text: '/rename bench' })],
      [
        {
          type: 'input-consumed',
          inboxId: 1,
          consumed: EInputConsumed.Command,
          command: { name: 'rename', argumentText: 'bench', text: '/rename bench' },
        },
      ],
    ])
    expect(renames).toEqual([{ sessionId: 'session-1', title: 'bench' }])
    expect(rig.appended.some((draft) => draft.type === 'user-said')).toBe(false)
  })

  it('runs a typed resize in the host without saying it', async () => {
    const resizes: unknown[] = []
    const resizeHandler: ControlCommandHandler<ControlPlane, unknown> = async ({ args }) => {
      resizes.push(args)
    }
    const rig = rigOf([entry(1, { text: '/resize 2 4' })], {
      registry: composeCommands([resize]),
      controlHandlers: new Map([['resize', resizeHandler]]),
    })
    const drain = await rig.intake.prepare()
    expect(drain).toEqual({ drafts: [], wakesTurn: false })
    expect(rig.appends).toEqual([
      [posted(1, { text: '/resize 2 4' })],
      [
        {
          type: 'input-consumed',
          inboxId: 1,
          consumed: EInputConsumed.Command,
          command: { name: 'resize', argumentText: '2 4', text: '/resize 2 4' },
        },
      ],
    ])
    expect(resizes).toEqual([{ vcpus: 2, memoryGb: 4 }])
    expect(rig.appended.some((draft) => draft.type === 'user-said')).toBe(false)
  })

  it('refuses a typed client command with the sentence that sends it to the menu', async () => {
    const rig = rigOf([entry(1, { text: '/model' })], { registry })
    const drain = await rig.intake.prepare()
    expect(drain).toEqual({ drafts: [], wakesTurn: false })
    expect(rig.appends).toEqual([
      [posted(1, { text: '/model' })],
      [
        {
          type: 'input-refused',
          inboxId: 1,
          reason: '/model opens in the app. Pick it from the / menu.',
        },
      ],
    ])
    expect(rig.appended.some((draft) => draft.type === 'user-said')).toBe(false)
  })
})

const skillSlash = (args: {
  names?: () => Promise<readonly string[]>
  load?: PodSlash['load']
}): PodSlash => ({
  names: args.names ?? (async () => ['review']),
  load:
    args.load ??
    (async ({ name, argumentText }) => ({
      ok: true,
      drafts: [
        {
          type: 'context-loaded',
          slot: EContextSlot.Skill,
          key: name,
          content: `review body for ${argumentText}`,
        },
      ],
    })),
})

const contextLoaded = (name: string, content: string): AppendBody =>
  ({ type: 'context-loaded', slot: EContextSlot.Skill, key: name, content }) as AppendBody

describe('InboxIntake typed skill text', () => {
  it('posts the typed line, loads the skill, then says the line', async () => {
    const rig = rigOf([entry(1, { text: '/review src/app.ts' })], {
      registry: composeCommands([]),
      slash: skillSlash({}),
    })
    const drain = await rig.intake.prepare()
    expect(drain).toEqual({ drafts: [], wakesTurn: true })
    expect(rig.appends).toEqual([
      [
        posted(1, { text: '/review src/app.ts' }),
        contextLoaded('review', 'review body for src/app.ts'),
        said(1, { text: '/review src/app.ts' }),
      ],
    ])
  })

  it('loads a skill for a line that the log already posted', async () => {
    const rig = rigOf([], {
      source: async () => [],
      registry: composeCommands([]),
      slash: skillSlash({}),
    })
    rig.appended.push(posted(4, { text: '/review src/app.ts' }))
    await rig.intake.prepare()
    expect(rig.appends).toEqual([
      [
        contextLoaded('review', 'review body for src/app.ts'),
        said(4, { text: '/review src/app.ts' }),
      ],
    ])
  })

  it('sends the line as a plain message when the names cannot be read', async () => {
    const rig = rigOf([entry(1, { text: '/review src/app.ts' })], {
      registry: composeCommands([]),
      slash: skillSlash({
        names: async () => {
          throw new Error('catalogue exploded')
        },
      }),
    })
    await rig.intake.prepare()
    expect(rig.appends).toEqual([
      [posted(1, { text: '/review src/app.ts' }), said(1, { text: '/review src/app.ts' })],
    ])
    expect(rig.warnings).toEqual(['reading the skill names failed, so the text stays a message'])
  })

  it('refuses the line when the skill cannot be loaded, and says nothing', async () => {
    const rig = rigOf([entry(1, { text: '/review src/app.ts' })], {
      registry: composeCommands([]),
      slash: skillSlash({
        load: async () => ({ ok: false, reason: 'the review skill has no body' }),
      }),
    })
    await rig.intake.prepare()
    expect(rig.appends).toEqual([
      [posted(1, { text: '/review src/app.ts' })],
      [{ type: 'input-refused', inboxId: 1, reason: 'the review skill has no body' }],
    ])
    expect(rig.appended.some((draft) => draft.type === 'user-said')).toBe(false)
  })

  it('reads no skill names for an empty inbox or a plain message', async () => {
    let reads = 0
    const slash = skillSlash({
      names: async () => {
        reads += 1
        return ['review']
      },
    })
    const empty = rigOf([], { registry: composeCommands([]), slash })
    await empty.intake.prepare()
    const plain = rigOf([entry(1, { text: 'review src/app.ts' })], {
      registry: composeCommands([]),
      slash,
    })
    await plain.intake.prepare()
    expect(reads).toBe(0)
  })

  it('reads the skill names once for a pass with two typed lines', async () => {
    let reads = 0
    const rig = rigOf([entry(1, { text: '/review a.ts' }), entry(2, { text: '/review b.ts' })], {
      registry: composeCommands([]),
      slash: skillSlash({
        names: async () => {
          reads += 1
          return ['review']
        },
      }),
    })
    await rig.intake.prepare()
    expect(reads).toBe(1)
  })

  it('lets a command name beat a skill name', async () => {
    const renames: { sessionId: string; title: string }[] = []
    const registry = composeCommands([renameCommand, modelCommand])
    const rig = rigOf([entry(1, { text: '/rename bench' })], {
      registry,
      controlHandlers: new Map([['rename', renameHandler]]),
      slash: skillSlash({ names: async () => ['rename'] }),
      renames,
    })
    await rig.intake.prepare()
    expect(renames).toEqual([{ sessionId: 'session-1', title: 'bench' }])
    expect(rig.appended.some((draft) => draft.type === 'context-loaded')).toBe(false)
    expect(rig.appended.some((draft) => draft.type === 'user-said')).toBe(false)
  })
})

const noticeOf = (args: { inboxId: number; restarting?: boolean; kind?: string }): InboxEntry =>
  entry(
    args.inboxId,
    {
      event: {
        type: 'service-ended',
        serviceId: 'svc-1',
        command: 'bun dev',
        status: 'exited',
        tail: '',
        ...(args.restarting === true ? { restarting: true } : {}),
      },
    },
    args.kind ?? 'event',
  )

describe('InboxIntake outside a turn', () => {
  it('drains a quiet notice into the log without starting a turn', async () => {
    const notice = noticeOf({ inboxId: 8, restarting: true })
    const rig = rigOf([notice], { commands: true })

    expect(await rig.intake.runCommands([notice])).toBe(true)

    expect(rig.appends).toEqual([
      [
        {
          type: 'service-ended',
          serviceId: 'svc-1',
          command: 'bun dev',
          status: EServiceStatus.Exited,
          tail: '',
          restarting: true,
        },
        { type: 'input-consumed', inboxId: 8 },
      ],
    ])
    expect(rig.appended.filter((draft) => draft.type === 'turn-started')).toEqual([])
  })

  it('drains a quiet notice on a host that runs no commands', async () => {
    const notice = noticeOf({ inboxId: 8, restarting: true })
    const rig = rigOf([notice])

    expect(await rig.intake.runCommands([notice])).toBe(true)

    expect(rig.appends.flat().map((draft) => draft.type)).toEqual([
      'service-ended',
      'input-consumed',
    ])
  })

  it('leaves a notice that takes a turn for the turn', async () => {
    const notice = noticeOf({ inboxId: 8 })
    const rig = rigOf([notice], { commands: true })

    expect(await rig.intake.runCommands([notice])).toBe(false)

    expect(rig.appends).toEqual([])
  })
})
