import { describe, expect, it } from 'bun:test'
import { testRender } from '@opentui/react/test-utils'
import React from 'react'

import { teardown } from '../markdown/__tests__/harness'

import { MAIN_LABEL, Threads, THREADS_HEADING } from '../components/threads'
import { loadingThreads, threadRows, withChips, withThreads } from '../threads-model'
import { frameOf } from './transcript-fixture'

const WIDTH = 110

const NOW = new Date('2026-08-25T12:00:00.000Z').getTime()

const state = () =>
  withThreads({
    state: loadingThreads({ now: NOW }),
    rows: threadRows({
      activeThreadId: 'thread-b',
      threads: [
        { id: 'thread-a', title: 'the auth overlay', updatedAt: '2026-08-25T11:58:00.000Z' },
        {
          id: 'thread-b',
          title: 'drawer work',
          updatedAt: '2026-08-25T10:30:00.000Z',
          worktree: { path: '/repo/.worktrees/drawer', branch: 'dennis/drawer' },
        },
      ],
    }),
  })

const framed = (nodeState = state()): Promise<string> =>
  frameOf(
    <Threads
      width={WIDTH}
      state={nodeState}
      overlay
      onPick={() => {}}
      onDismiss={() => {}}
      onQueryChange={() => {}}
    />,
    WIDTH,
  )

describe('the conversations drawer', () => {
  it('heads the drawer and names each conversation', async () => {
    const frame = await framed()

    expect(frame).toContain(THREADS_HEADING.toUpperCase())
    expect(frame).toContain('the auth overlay')
    expect(frame).toContain('drawer work')
  })

  it('names the main tree for a thread that never took a worktree', async () => {
    expect(await framed()).toContain(MAIN_LABEL)
  })

  it('names the branch of the worktree a thread is standing in', async () => {
    expect(await framed()).toContain('⑂ dennis/drawer')
  })

  it('marks the conversation already on screen', async () => {
    expect(await framed()).toContain('(current)')
  })

  it('pins the pull request pill to the place line of the row it belongs to', async () => {
    const chipped = withChips({
      state: state(),
      chips: new Map([['thread-b', [{ label: '#401', ground: '#000', ink: '#fff' }]]]),
    })
    const frame = await framed(chipped)

    expect(frame.split('\n').find((line) => line.includes('⑂ dennis/drawer'))).toContain('#401')
    expect(frame.split('\n').find((line) => line.includes('⌂ main'))).not.toContain('#401')
  })

  it('keeps the name and the last touch on the first line', async () => {
    const frame = await framed()
    const row = frame.split('\n').find((line) => line.includes('the auth overlay'))

    expect(row).toContain('2m ago')
    expect(row).not.toContain('⌂ main')
  })

  it('keeps the filter line and the hints', async () => {
    const frame = await framed()

    expect(frame).toContain('type to filter')
    expect(frame).toContain('open')
  })

  it('types into a real input, so editing keeps up with held keys and pastes', async () => {
    let query = ''
    const setup = await testRender(
      <box flexDirection="column" width={WIDTH} height={30}>
        <Threads
          width={WIDTH}
          state={state()}
          overlay
          onPick={() => {}}
          onDismiss={() => {}}
          onQueryChange={(next) => {
            query = next
          }}
        />
      </box>,
      { width: WIDTH, height: 30 },
    )
    try {
      await setup.mockInput.typeText('auth')
      await setup.flush()

      expect(query).toBe('auth')
    } finally {
      await teardown(setup)
    }
  })

  it('scrolls the list itself when the rows outgrow it', async () => {
    const many = withThreads({
      state: loadingThreads({ now: NOW }),
      rows: threadRows({
        activeThreadId: '',
        threads: Array.from({ length: 30 }, (_, at) => ({
          id: `thread-${String(at).padStart(2, '0')}`,
          title: `conversation ${at}`,
          updatedAt: '2026-08-25T11:58:00.000Z',
        })),
      }),
    })
    const frame = await framed(many)

    expect(frame).toContain('conversation 0')
    expect(frame).not.toContain('conversation 29')
  })
})
