import { describe, expect, it } from 'bun:test'

import { ECompactionAnchor, EWorktreeExit } from '../../../events/body'
import { contextFor, log } from '../../__tests__/log-fixture'
import { messagesFromEvents } from '../messages-from-events'
import { worktreeBlock } from '../worktree-block'

const LAUNCH = '/w'
const TREE = '/w/.atlas/worktrees/eng-327'

const entered = { type: 'worktree-entered' as const, path: TREE, branch: 'dennis/eng-327', base: 'origin/main' }

const assembleWith = (events: ReturnType<typeof log>, options?: { repoRoot?: string; launch?: string }) => {
  const ctx = contextFor({ events })
  const withMessages = messagesFromEvents()({ system: [], messages: [] }, ctx)
  return worktreeBlock({ launchDirectory: options?.launch ?? LAUNCH, repoRoot: options?.repoRoot })(
    withMessages,
    ctx,
  )
}

const textsOf = (assembled: ReturnType<typeof assembleWith>): string[] =>
  assembled.messages.flatMap((entry) =>
    entry.message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])),
  )

const noteOf = (assembled: ReturnType<typeof assembleWith>): string => textsOf(assembled).at(-1) ?? ''

describe('telling the model the project directory and any active worktree', () => {
  it('states the launch directory even when no worktree was ever entered', () => {
    const assembled = assembleWith(log([{ type: 'user-said', text: 'hello' }]))

    expect(assembled.system).toEqual([])
    expect(textsOf(assembled)[0]).toBe('hello')
    expect(noteOf(assembled)).toContain('Project directory: /w.')
    expect(noteOf(assembled)).not.toContain('worktree')
  })

  it('adds nothing to an empty transcript', () => {
    expect(assembleWith(log([])).messages).toEqual([])
  })

  it('keeps an invalid assistant tail visible to exchange validation', () => {
    const assembled = assembleWith(log([
      { type: 'user-said', text: 'request' },
      { type: 'assistant-said', parts: [{ type: 'text', text: 'answer' }] },
    ]))

    expect(assembled.messages.at(-1)?.message.role).toBe('assistant')
    expect(textsOf(assembled)).toEqual(['request', 'answer'])
  })

  it('names the worktree, its branch, what it was branched from and the main checkout', () => {
    const note = noteOf(assembleWith(log([entered])))

    expect(note).toContain(`Project directory: ${TREE}`)
    expect(note).toContain('dennis/eng-327')
    expect(note).toContain('branched from origin/main')
    expect(note).toContain("main checkout is at /w;")
  })

  it('never leaves the system prompt, and rides a user-role reminder anchored to the last event', () => {
    const assembled = assembleWith(
      log([{ type: 'user-said', text: 'hello' }, entered, { type: 'user-said', text: 'much later' }]),
    )
    const tail = assembled.messages.at(-1)

    expect(assembled.system).toEqual([])
    expect(tail?.message.role).toBe('user')
    expect(tail?.origin.seq).toBe(3)
    expect(textsOf(assembled).slice(0, 2)).toEqual(['hello', 'much later'])
    expect(noteOf(assembled)).toStartWith('<system-reminder>')
    expect(noteOf(assembled)).toContain(TREE)
  })

  it('keeps the main checkout advisory and does not authorise committing or pushing', () => {
    const note = noteOf(assembleWith(log([entered])))

    expect(note).toContain('stays unchanged unless the developer asks')
    expect(note).not.toMatch(/commit/i)
    expect(note).not.toMatch(/push/i)
  })

  it('tells the model an adopted worktree is tracked, not branched, and will not be removed', () => {
    const note = noteOf(assembleWith(log([{ ...entered, base: 'origin/topic', adopted: true }])))

    expect(note).toContain('which tracks origin/topic')
    expect(note).not.toContain('branched from')
    expect(note).toContain('will not remove a worktree Atlas did not create')
  })

  it('says an adopted worktree has no upstream rather than naming a base it does not have', () => {
    const note = noteOf(
      assembleWith(log([{ type: 'worktree-entered', path: TREE, branch: 'lonely', adopted: true }])),
    )

    expect(note).toContain('which has no upstream')
  })

  it('names the repository root rather than the launch directory when the session started in another worktree', () => {
    const launchedInside = '/repo/.claude/worktrees/feat-a'
    const note = noteOf(assembleWith(log([entered]), { launch: launchedInside, repoRoot: '/repo' }))

    expect(note).toContain('main checkout is at /repo;')
    expect(note).not.toContain(launchedInside)
  })

  it('returns to the plain project directory once the worktree is exited, naming where it went back to', () => {
    const note = noteOf(
      assembleWith(
        log([entered, { type: 'worktree-exited', path: TREE, action: EWorktreeExit.Keep, returnTo: '/repo' }]),
      ),
    )

    expect(note).toContain('Project directory: /repo.')
    expect(note).not.toContain(TREE)
    expect(note).not.toContain('git worktree')
  })

  it('follows a directory change to the new project directory', () => {
    const note = noteOf(
      assembleWith(log([entered, { type: 'directory-changed', path: '/other', repo: '/other' }])),
    )

    expect(note).toContain('Project directory: /other.')
  })

  it('still folds the entry after the history covering it is compacted', () => {
    const assembled = assembleWith(
      log([
        entered,
        { type: 'user-said', text: 'hello' },
        {
          type: 'history-compacted',
          anchor: ECompactionAnchor.Prefix,
          fromSeq: 1,
          throughSeq: 2,
          summary: 'The session entered a worktree.',
          replaced: 2,
        },
      ]),
    )

    expect(noteOf(assembled)).toContain(TREE)
  })
})
