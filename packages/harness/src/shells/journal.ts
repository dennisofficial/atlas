import { EventLogPort, IdPort, type EventDraft, type ThreadId } from '@dltech/atlas-core'

import type { ShellDelta, ShellSnapshot } from './background-shell'
import type { ShellId } from './shell-id'
import type { MatchedLines } from './shell-watch'

export function startedDraft(args: { snapshot: ShellSnapshot }): EventDraft {
  const { snapshot } = args

  return {
    type: 'background-shell-started',
    shellId: snapshot.shellId,
    command: snapshot.command,
    description: snapshot.description,
    bootId: snapshot.bootId,
  }
}

export function endedDraft(args: { snapshot: ShellSnapshot; delta: ShellDelta }): EventDraft {
  const { snapshot, delta } = args

  return {
    type: 'background-shell-ended',
    shellId: snapshot.shellId,
    command: snapshot.command,
    description: snapshot.description,
    bootId: snapshot.bootId,
    status: snapshot.status,
    killedBy: snapshot.killedBy,
    exitCode: snapshot.exitCode,
    output: delta.text,
    droppedCharacters: delta.droppedCharacters,
    remainingCharacters: delta.remainingCharacters,
  }
}

export function awaitingInputDraft(args: {
  snapshot: ShellSnapshot
  delta: ShellDelta
}): EventDraft {
  const { snapshot, delta } = args

  return {
    type: 'background-shell-awaiting-input',
    shellId: snapshot.shellId,
    command: snapshot.command,
    description: snapshot.description,
    output: delta.text,
    droppedCharacters: delta.droppedCharacters,
    remainingCharacters: delta.remainingCharacters,
  }
}

export function matchedDraft(args: {
  snapshot: ShellSnapshot
  pattern: string
  matched: MatchedLines
}): EventDraft {
  const { snapshot, matched } = args

  return {
    type: 'background-shell-matched',
    shellId: snapshot.shellId,
    command: snapshot.command,
    description: snapshot.description,
    pattern: args.pattern,
    lines: matched.lines.join('\n'),
    matchCount: matched.matchCount,
    watchDisarmed: matched.disarmed ? true : undefined,
  }
}

export enum EJournalSkip {
  Superseded = 'superseded',
  Failed = 'failed',
}

export type JournalAppend = { appended: true } | { appended: false; reason: EJournalSkip }

type ShellKey = { threadId: ThreadId; shellId: ShellId }

const keyOf = ({ threadId, shellId }: ShellKey): string => `${threadId}\u0000${shellId}`

/**
 * The single writer of `background-shell-*` events. Appends for one (thread, shell) pair run one
 * after another in the order they were enqueued, so a shell's facts land in occurrence order even
 * when their callers race; different shells never wait on each other. A failed append is warned
 * about and dropped, and the chain carries on: a lost fact, never a corrupted one. `started` is
 * held to the same rule, so a caller that must not wait on its own record simply does not await it.
 */
export class ShellEventJournal {
  private readonly log: EventLogPort
  private readonly ids: IdPort
  private readonly warn: (message: string) => void
  private readonly tails = new Map<string, Promise<void>>()
  private readonly disowned = new Set<string>()

  constructor(args: { log: EventLogPort; ids: IdPort; warn: (message: string) => void }) {
    this.log = args.log
    this.ids = args.ids
    this.warn = args.warn
  }

  started(args: ShellKey & { snapshot: ShellSnapshot }): Promise<JournalAppend> {
    return this.enqueue({
      ...args,
      kind: 'start',
      drafts: () => [startedDraft({ snapshot: args.snapshot })],
    })
  }

  matched(
    args: ShellKey & { snapshot: ShellSnapshot; pattern: string; matched: MatchedLines },
  ): Promise<JournalAppend> {
    return this.enqueue({
      ...args,
      kind: 'match',
      drafts: () => [
        matchedDraft({ snapshot: args.snapshot, pattern: args.pattern, matched: args.matched }),
      ],
    })
  }

  awaitingInput(
    args: ShellKey & { snapshot: ShellSnapshot; delta: ShellDelta },
  ): Promise<JournalAppend> {
    return this.enqueue({
      ...args,
      kind: 'awaiting-input',
      drafts: () => [awaitingInputDraft({ snapshot: args.snapshot, delta: args.delta })],
    })
  }

  ended(
    args: ShellKey & {
      snapshot: ShellSnapshot
      delta: ShellDelta
      hooked: readonly EventDraft[]
    },
  ): Promise<JournalAppend> {
    return this.enqueue({
      ...args,
      kind: 'ending',
      drafts: () => [endedDraft({ snapshot: args.snapshot, delta: args.delta }), ...args.hooked],
    })
  }

  disown(args: ShellKey): Promise<void> {
    const key = keyOf(args)
    this.disowned.add(key)
    return this.tails.get(key) ?? Promise.resolve()
  }

  private enqueue(args: ShellKey & { kind: string; drafts: () => EventDraft[] }): Promise<JournalAppend> {
    const key = keyOf(args)
    if (this.disowned.has(key)) {
      return Promise.resolve({ appended: false, reason: EJournalSkip.Superseded })
    }

    const prior = this.tails.get(key) ?? Promise.resolve()
    const result = prior.then(() => this.write({ ...args }))
    const tail = result.then(() => undefined)
    this.tails.set(key, tail)
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key)
    })
    return result
  }

  private async write(
    args: ShellKey & { kind: string; drafts: () => EventDraft[] },
  ): Promise<JournalAppend> {
    try {
      await this.log.append({
        threadId: args.threadId,
        runId: this.ids.nextRunId(),
        drafts: args.drafts(),
      })
      return { appended: true }
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause)
      this.warn(`could not record background shell ${args.kind} for ${args.shellId}: ${reason}`)
      return { appended: false, reason: EJournalSkip.Failed }
    }
  }
}
