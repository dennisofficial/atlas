import { describe, expect, it } from 'bun:test'

import { EShellStatus } from '../../../shells/status'
import { contextFor, log } from '../../__tests__/log-fixture'
import { messagesFromEvents } from '../messages-from-events'
import {
  runningShellsBlock,
  type RunningShell,
  type RunningShellsSource,
} from '../running-shells-block'

const started = (over: { shellId?: string; command?: string; description?: string } = {}) => ({
  type: 'background-shell-started' as const,
  shellId: over.shellId ?? 'shell-1',
  command: over.command ?? 'bun test --watch',
  ...(over.description === undefined ? {} : { description: over.description }),
})

const ended = (shellId = 'shell-1') => ({
  type: 'background-shell-ended' as const,
  shellId,
  command: 'bun test --watch',
  status: EShellStatus.Exited,
  output: 'ok\n',
  droppedCharacters: 0,
  remainingCharacters: 0,
})

const assemble = (args: {
  events: ReturnType<typeof log>
  runningShells?: RunningShellsSource
}) => {
  const ctx = contextFor({ events: args.events })
  const withMessages = messagesFromEvents()({ system: [], messages: [] }, ctx)
  return runningShellsBlock({
    ...(args.runningShells === undefined ? {} : { runningShells: args.runningShells }),
  })(withMessages, ctx)
}

const remindersOf = (assembled: ReturnType<typeof assemble>): string[] =>
  assembled.messages
    .flatMap((entry) =>
      entry.message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])),
    )
    .filter((text) => text.includes('These background shells are still running:'))

describe('the running-shells reminder from the journal', () => {
  it('lists a shell that started and has no ending', () => {
    const events = log([
      { type: 'user-said', text: 'start the watcher' },
      started({ description: 'the watcher' }),
    ])

    const texts = remindersOf(assemble({ events }))

    expect(texts).toHaveLength(1)
    expect(texts[0]).toContain('shell-1')
    expect(texts[0]).toContain('"the watcher" (`bun test --watch`)')
  })

  it('says nothing once the shell has ended', () => {
    const events = log([{ type: 'user-said', text: 'start the watcher' }, started(), ended()])

    expect(remindersOf(assemble({ events }))).toEqual([])
  })

  it('claims no character count it cannot know', () => {
    const events = log([{ type: 'user-said', text: 'run it' }, started()])

    const [text] = remindersOf(assemble({ events }))

    expect(text).not.toContain('0 characters printed')
    expect(text).toContain('shell-1  `bun test --watch`')
  })

  it('falls back to the journal only when no live source is given', () => {
    const events = log([{ type: 'user-said', text: 'run it' }, started({ shellId: 'shell-1' })])
    const fromSource: readonly RunningShell[] = [
      { shellId: 'shell-9', command: 'tail -f log', awaitingInput: true, totalCharacters: 42 },
    ]

    const texts = remindersOf(assemble({ events, runningShells: () => fromSource }))

    expect(texts[0]).toContain('shell-9')
    expect(texts[0]).toContain('tail -f log')
    expect(texts[0]).toContain('awaiting input')
    expect(texts[0]).not.toContain('shell-1')
  })
})
