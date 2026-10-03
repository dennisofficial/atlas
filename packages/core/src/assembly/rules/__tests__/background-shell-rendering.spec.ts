import { describe, expect, it } from 'bun:test'

import type { EventDraft } from '../../../events/body'
import { shellEventContextsOf } from '../../../shells/lifecycle'
import { EShellStatus } from '../../../shells/status'
import type { Assembled } from '../../assembled'
import { contextFor, log } from '../../__tests__/log-fixture'
import { backgroundShellAwaitingInputBlock, backgroundShellBlock } from '../background-shell-block'
import { messagesFromEvents } from '../messages-from-events'

const empty: Assembled = { system: [], messages: [] }

const started = (over: { shellId?: string; bootId?: string; outputPath?: string } = {}): EventDraft => ({
  type: 'background-shell-started',
  shellId: 'bash_1',
  command: 'bun test',
  ...over,
})

const ended = (over: Record<string, unknown> = {}): EventDraft =>
  ({
    type: 'background-shell-ended',
    shellId: 'bash_1',
    command: 'bun test',
    status: EShellStatus.Exited,
    exitCode: 0,
    output: '261 pass\n',
    droppedCharacters: 0,
    remainingCharacters: 0,
    ...over,
  }) as EventDraft

const matched = (over: Record<string, unknown> = {}): EventDraft =>
  ({
    type: 'background-shell-matched',
    shellId: 'bash_1',
    command: 'bun test',
    pattern: 'pass',
    lines: '261 pass\n',
    matchCount: 1,
    ...over,
  }) as EventDraft

const awaiting = (over: Record<string, unknown> = {}): EventDraft =>
  ({
    type: 'background-shell-awaiting-input',
    shellId: 'bash_1',
    command: 'npm init',
    output: 'package name: ',
    droppedCharacters: 0,
    remainingCharacters: 0,
    ...over,
  }) as EventDraft

const render = (drafts: readonly EventDraft[]): string[] => {
  const assembled = messagesFromEvents()(empty, contextFor({ events: log(drafts) }))
  return assembled.messages.flatMap((entry) =>
    entry.message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])),
  )
}

describe('a watch match and the ending recorded in the same step', () => {
  const texts = render([started(), matched(), ended()])

  it('states the match as a fact without freezing the shell as alive', () => {
    expect(texts[0]).toContain('<background-shell-matched>')
    expect(texts[0]).toContain('watch matched 1 line')
    expect(texts[0]).not.toContain('still running')
    expect(texts[0]).not.toContain('has not ended')
  })

  it('still hands the model the ending as its own message', () => {
    expect(texts[1]).toContain('<background-shell-ended>')
    expect(texts[1]).toContain('finished successfully')
  })
})

describe('a match logged after the shell already ended', () => {
  const texts = render([started(), ended(), matched()])
  const block = texts[1] ?? ''

  it('says the shell ended and there is nothing to wait for', () => {
    expect(block).toContain('had already ended')
    expect(block).toContain('finished successfully')
    expect(block).toContain('nothing to wait for')
  })

  it('never claims the shell is running or that an ending is coming', () => {
    expect(block).not.toContain('still running')
    expect(block).not.toContain('has not ended')
    expect(block).not.toContain('will still arrive')
  })

  it('applies to a legacy match that carries no boot id too', () => {
    const legacy = render([started({ bootId: 'boot-a' }), ended({ bootId: 'boot-a' }), matched()])

    expect(legacy[1]).toContain('had already ended')
  })
})

describe('a shell id reused on a later boot', () => {
  const drafts = [
    started({ bootId: 'boot-a' }),
    ended({ bootId: 'boot-a' }),
    started({ bootId: 'boot-b' }),
    matched({ bootId: 'boot-b' }),
  ]

  it('does not read the old boot ending as the new shell having ended', () => {
    const block = render(drafts)[1] ?? ''

    expect(block).toContain('watch matched')
    expect(block).not.toContain('had already ended')
  })

  it('still ties a late match to the boot it names', () => {
    const late = render([...drafts, matched({ bootId: 'boot-a' })])

    expect(late[2]).toContain('had already ended')
  })

  it('resolves a match with no boot id to the most recent start', () => {
    const contexts = shellEventContextsOf(log([...drafts.slice(0, 3), matched()]))

    const notice = log([...drafts.slice(0, 3), matched()])[3]
    const context = notice === undefined ? undefined : contexts.get(notice.id)

    expect(context?.started?.bootId).toBe('boot-b')
    expect(context?.endedBefore).toBeUndefined()
  })

  it('scopes the awaiting-input notice the same way', () => {
    const block = render([...drafts.slice(0, 3), awaiting({ bootId: 'boot-b' })])[1] ?? ''

    expect(block).toContain('waiting on input')
    expect(block).not.toContain('had already ended')
  })
})

describe('where the full output lives', () => {
  const path = '/threads/t1/shells/bash_1.log'

  it('gives an ending the path and tells the model to read or grep it', () => {
    const block = backgroundShellBlock(
      log([ended({ outputPath: path, outputStart: 0, outputEnd: 9 })])[0] as Parameters<typeof backgroundShellBlock>[0],
    )

    expect(block).toContain(path)
    expect(block).toContain('read or grep')
    expect(block).toContain('Recorded source range: bytes 0 to 9')
    expect(block).toContain('excerpt')
  })

  it('takes the path from the start event when the ending does not carry it', () => {
    const texts = render([started({ outputPath: path }), ended()])

    expect(texts[0]).toContain(path)
  })

  it('caps the tail of a very long output and keeps its end', () => {
    const output = `${'x'.repeat(20_000)}FINAL LINE\n`
    const block = render([started({ outputPath: path }), ended({ output })])[0] ?? ''

    expect(block).toContain('Only the last 8000 of 20010 characters')
    expect(block).toContain('FINAL LINE')
    expect(block.length).toBeLessThan(9_000)
  })

  it('keeps the legacy inline rendering when no path was recorded', () => {
    const block = render([ended({ remainingCharacters: 50 })])[0] ?? ''

    expect(block).toContain('Everything it printed follows')
    expect(block).toContain('shell_output({ shellId: "bash_1" })')
    expect(block).not.toContain('read or grep')
  })

  it('names the path on a match so the model can search beyond the pattern', () => {
    const block = render([started({ outputPath: path }), matched()])[0] ?? ''

    expect(block).toContain(path)
  })
})

describe('a shell that is waiting on input', () => {
  it('tells a legacy shell to use shell_input when supported, else re-run noninteractively', () => {
    const block = backgroundShellAwaitingInputBlock(
      log([awaiting()])[0] as Parameters<typeof backgroundShellAwaitingInputBlock>[0],
    )

    expect(block).toContain('Use shell_input when input is supported; otherwise re-run it noninteractively')
    expect(block).not.toContain('Kill it with shell_kill and start it again')
  })

  it('tells a shell that supports input to answer it with shell_input', () => {
    const block = backgroundShellAwaitingInputBlock(
      log([awaiting({ inputSupported: true })])[0] as Parameters<typeof backgroundShellAwaitingInputBlock>[0],
    )

    expect(block).toContain('shell_input')
    expect(block).not.toContain('stdin is closed')
  })

  it('says plainly that a prompt arriving after the ending is moot', () => {
    const block = render([started(), ended(), awaiting()])[1] ?? ''

    expect(block).toContain('had already ended')
    expect(block).not.toContain('waiting on input')
  })
})

describe('contexts keyed by event id', () => {
  it('keeps two events that share a seq apart, as an inherited thread does', () => {
    const own = log([started(), matched()])
    const inherited = log([started(), ended(), matched()]).map((event) => ({
      ...event,
      id: `inherited-${event.id}` as typeof event.id,
    }))
    const contexts = shellEventContextsOf([...inherited, ...own])

    const inheritedMatch = inherited[2]
    const ownMatch = own[1]
    expect(inheritedMatch !== undefined && contexts.get(inheritedMatch.id)?.endedBefore).toBeTruthy()
    expect(ownMatch !== undefined && contexts.get(ownMatch.id)?.started).toBeTruthy()
    expect(contexts.size).toBe(3)
  })
})

describe('legacy shells with no boot id reusing one shell id', () => {
  const first = [started(), ended({ output: 'first\n' })]

  it('pairs a progress notice with the most recent start, not the first ending', () => {
    const texts = render([...first, started(), matched()])

    expect(texts[1]).toContain('watch matched')
    expect(texts[1]).not.toContain('had already ended')
  })

  it('reports the second run as ended once its own ending is recorded', () => {
    const texts = render([...first, started(), ended({ output: 'second\n' }), matched()])

    expect(texts[2]).toContain('had already ended')
  })
})
