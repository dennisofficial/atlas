import {
  arrivedDraft,
  deliveredDraft,
  EventLogPort,
  IdPort,
  type EventDraft,
  type ThreadId,
} from '@dltech/atlas-core'

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
    ...(snapshot.outputPath === undefined ? {} : { outputPath: snapshot.outputPath }),
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
    ...(snapshot.outputPath === undefined ? {} : { outputPath: snapshot.outputPath }),
    ...(delta.outputStart === undefined ? {} : { outputStart: delta.outputStart }),
    ...(delta.outputEnd === undefined ? {} : { outputEnd: delta.outputEnd }),
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
    ...(snapshot.bootId === undefined ? {} : { bootId: snapshot.bootId }),
    ...(snapshot.inputSupported === undefined ? {} : { inputSupported: snapshot.inputSupported }),
    ...(snapshot.outputPath === undefined ? {} : { outputPath: snapshot.outputPath }),
    ...(delta.outputStart === undefined ? {} : { outputStart: delta.outputStart }),
    ...(delta.outputEnd === undefined ? {} : { outputEnd: delta.outputEnd }),
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
    ...(snapshot.bootId === undefined ? {} : { bootId: snapshot.bootId }),
    ...(snapshot.outputPath === undefined ? {} : { outputPath: snapshot.outputPath }),
  }
}

export enum EJournalSkip {
  Superseded = 'superseded',
  Failed = 'failed',
  Ended = 'ended',
}

export type JournalAppend =
  | { appended: true; delivered?: EventDraft | undefined }
  | { appended: false; reason: EJournalSkip }

type Stamped = { arrived: EventDraft; delivered: EventDraft }

type ShellWrite = ShellKey & {
  kind: string
  drafts: () => EventDraft[]
  delivered?: EventDraft | undefined
}

type ShellKey = {
  threadId: ThreadId
  shellId: ShellId
  snapshot?: Pick<ShellSnapshot, 'bootId'> | undefined
  occurrenceId?: string | undefined
}

const shellScope = ({ threadId, shellId }: ShellKey): string => `${threadId}\u0000${shellId}\u0000`
const keyOf = (args: ShellKey): string =>
  `${shellScope(args)}${args.snapshot?.bootId ?? ''}\u0000${args.occurrenceId ?? ''}`

export class ShellEventJournal {
  private readonly log: EventLogPort
  private readonly ids: IdPort
  private readonly warn: (message: string) => void
  private readonly tails = new Map<string, Promise<void>>()
  private readonly disowned = new Set<string>()
  private readonly terminal = new Set<string>()
  private readonly endingWrites = new Map<string, Promise<JournalAppend>>()
  private readonly failedEndings = new Set<string>()

  constructor(args: { log: EventLogPort; ids: IdPort; warn: (message: string) => void }) {
    this.log = args.log
    this.ids = args.ids
    this.warn = args.warn
  }

  private stamp(draft: EventDraft): Stamped {
    const id = String(this.ids.nextEventId())
    return { arrived: arrivedDraft({ draft, id }), delivered: deliveredDraft({ draft, id }) }
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
    const { arrived, delivered } = this.stamp(
      matchedDraft({ snapshot: args.snapshot, pattern: args.pattern, matched: args.matched }),
    )
    return this.enqueue({ ...args, kind: 'match', drafts: () => [arrived], delivered })
  }

  awaitingInput(
    args: ShellKey & { snapshot: ShellSnapshot; delta: ShellDelta },
  ): Promise<JournalAppend> {
    const { arrived, delivered } = this.stamp(
      awaitingInputDraft({ snapshot: args.snapshot, delta: args.delta }),
    )
    return this.enqueue({ ...args, kind: 'awaiting-input', drafts: () => [arrived], delivered })
  }

  ended(
    args: ShellKey & {
      snapshot: ShellSnapshot
      delta: ShellDelta
      hooked: readonly EventDraft[]
    },
  ): Promise<JournalAppend> {
    const key = keyOf(args)
    if (this.endingWrites.has(key) && !this.failedEndings.has(key)) {
      return Promise.resolve({ appended: false, reason: EJournalSkip.Ended })
    }
    this.failedEndings.delete(key)
    this.terminal.add(key)
    const { arrived, delivered } = this.stamp(
      endedDraft({ snapshot: args.snapshot, delta: args.delta }),
    )
    const ending = this.enqueue({
      ...args,
      kind: 'ending',
      drafts: () => [arrived, ...args.hooked],
      delivered,
    })
    this.endingWrites.set(key, ending)
    void ending.then((result) => {
      if (!result.appended && result.reason === EJournalSkip.Failed) this.failedEndings.add(key)
    })
    return ending
  }

  async flush(): Promise<void> {
    await Promise.all(this.tails.values())
  }

  async disown(args: ShellKey): Promise<void> {
    const scope = shellScope(args)
    this.disowned.add(scope)
    await Promise.all(
      [...this.tails].flatMap(([key, tail]) => (key.startsWith(scope) ? [tail] : [])),
    )
  }

  private enqueue(args: ShellWrite): Promise<JournalAppend> {
    const key = keyOf(args)
    if (this.disowned.has(shellScope(args))) {
      return Promise.resolve({ appended: false, reason: EJournalSkip.Superseded })
    }
    if (this.terminal.has(key) && args.kind !== 'ending') {
      return Promise.resolve({ appended: false, reason: EJournalSkip.Ended })
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

  private async write(args: ShellWrite): Promise<JournalAppend> {
    if (this.disowned.has(shellScope(args))) {
      return { appended: false, reason: EJournalSkip.Superseded }
    }
    try {
      await this.log.append({
        threadId: args.threadId,
        runId: this.ids.nextRunId(),
        drafts: args.drafts(),
      })
      return { appended: true, delivered: args.delivered }
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause)
      this.warn(`could not record background shell ${args.kind} for ${args.shellId}: ${reason}`)
      return { appended: false, reason: EJournalSkip.Failed }
    }
  }
}
