import type { HookChainSource } from '../hooks/registry'
import { afterShellDrafts } from './after-shell'
import { ENotice } from './attention'
import type { BackgroundShell, ShellDelta, ShellSnapshot } from './background-shell'
import type { JournalAppend } from './journal'
import { tailOf } from './output-preview'
import { RegistryState, type Tracked } from './registry-entries'
import type { MatchedLines } from './shell-watch'

const ENDED_TAIL_BYTES = 8_192

const outputExcerpt = async (args: { entry: Tracked; finished: boolean }): Promise<ShellDelta> => {
  const { entry } = args
  const attachment = entry.shell.attachment
  if (attachment === undefined) return { text: '', droppedCharacters: 0, remainingCharacters: 0 }
  const total = attachment.totalBytes()
  const start = Math.max(total - ENDED_TAIL_BYTES, 0)
  const text = await tailOf({ attachment, limit: ENDED_TAIL_BYTES, finished: args.finished })
  return { text, droppedCharacters: 0, remainingCharacters: 0, outputStart: start, outputEnd: total }
}

export class ShellEvents {
  constructor(
    private readonly state: RegistryState,
    private readonly hooks: HookChainSource,
  ) {}

  async recordEnding(entry: Tracked): Promise<{ delta: ShellDelta; appended: boolean } | undefined> {
    const { state } = this
    const snapshot = entry.shell.snapshot()
    const delta = await outputExcerpt({ entry, finished: true }).catch((error: unknown) => ({
      text: `Atlas could not read the output excerpt: ${error instanceof Error ? error.message : String(error)}`,
      droppedCharacters: 0,
      remainingCharacters: snapshot.totalCharacters,
    }))
    const hooked = await afterShellDrafts({
      hooks: this.hooks,
      threadId: entry.threadId,
      shell: snapshot,
    })
    if (state.tracked.get(snapshot.shellId) !== entry) return undefined

    if (state.journal !== undefined) {
      const persisted = await state.journal.ended({
        threadId: entry.threadId,
        shellId: snapshot.shellId,
        snapshot,
        delta,
        hooked,
      })
      if (!persisted.appended) return { delta, appended: false }
    }
    if (state.tracked.get(snapshot.shellId) !== entry) return { delta, appended: true }
    state.notices.queue({ kind: ENotice.Ended, snapshot, threadId: entry.threadId })
    return { delta, appended: true }
  }

  announceAwaitingInput(shell: BackgroundShell): void {
    const entry = this.state.tracked.get(shell.shellId)
    if (entry === undefined || entry.announced) return

    this.state.bump()
    void this.recordPrompt({ entry, shell })
  }

  announceMatched(args: { shell: BackgroundShell; matched: MatchedLines }): void {
    const { shell, matched } = args
    const entry = this.state.tracked.get(shell.shellId)
    if (entry === undefined || entry.announced || entry.pattern === undefined) return

    const snapshot = shell.snapshot()
    const recorded = this.state.journal?.matched({
      threadId: entry.threadId,
      shellId: shell.shellId,
      snapshot,
      pattern: entry.pattern,
      matched,
    })
    void this.ring({ entry, snapshot, kind: ENotice.Matched, recorded })
  }

  private async recordPrompt(args: { entry: Tracked; shell: BackgroundShell }): Promise<void> {
    const { entry, shell } = args
    const snapshot = shell.snapshot()
    const delta = await outputExcerpt({ entry, finished: false }).catch((error: unknown) => ({
      text: `Atlas could not read the prompt excerpt: ${error instanceof Error ? error.message : String(error)}`,
      droppedCharacters: 0,
      remainingCharacters: snapshot.totalCharacters,
    }))
    const recorded = this.state.journal?.awaitingInput({
      threadId: entry.threadId,
      shellId: shell.shellId,
      snapshot,
      delta,
    })
    await this.ring({ entry, snapshot, kind: ENotice.AwaitingInput, recorded })
  }

  private async ring(args: {
    entry: Tracked
    snapshot: ShellSnapshot
    kind: ENotice
    recorded: Promise<JournalAppend> | undefined
  }): Promise<void> {
    const recorded = await args.recorded
    if (recorded !== undefined && !recorded.appended) return
    if (this.state.tracked.get(args.snapshot.shellId) !== args.entry) return
    this.state.notices.queue({
      kind: args.kind,
      snapshot: args.snapshot,
      threadId: args.entry.threadId,
    })
  }
}
