import { describe, expect, it } from 'bun:test'

import { shellRosterOf, shellsClient, shellsOfView } from '..'

const row = (overrides: Record<string, unknown> = {}) => ({
  shellId: 'sh1',
  name: 'dev server',
  command: 'bun run dev',
  status: 'running',
  characters: 0,
  awaitingInput: false,
  changedAt: '2026-11-08T10:00:00.000Z',
  ...overrides,
})

describe('shellsClient', () => {
  it('applies its roster hook to background shell events only', () => {
    const [hook] = shellsClient.hooks
    expect(hook?.name).toBe('shells-roster')
    expect(hook?.appliesTo({ type: 'background-shell-started' } as never)).toBe(true)
    expect(hook?.appliesTo({ type: 'subscription-created' } as never)).toBe(false)
  })
})

describe('shellsOfView', () => {
  it('is empty when the view has no shells entry', () => {
    expect(shellsOfView({})).toEqual([])
  })
})

describe('shellRosterOf', () => {
  it('is zeroes when the view is absent', () => {
    expect(shellRosterOf({})).toEqual({ running: 0, awaitingInput: false, labels: [] })
  })

  it('counts and labels two running shells', () => {
    const views = { shells: [row(), row({ shellId: 'sh2', name: 'watcher' })] }
    expect(shellRosterOf(views)).toEqual({
      running: 2,
      awaitingInput: false,
      labels: ['dev server', 'watcher'],
    })
  })

  it('leaves ended shells out of the roster', () => {
    const views = {
      shells: [
        row(),
        row({ shellId: 'sh2', status: 'exited' }),
        row({ shellId: 'sh3', status: 'killed', awaitingInput: true }),
        row({ shellId: 'sh4', status: 'overflowed' }),
      ],
    }
    expect(shellRosterOf(views)).toEqual({
      running: 1,
      awaitingInput: false,
      labels: ['dev server'],
    })
  })

  it('flags when a running shell is awaiting input', () => {
    const views = { shells: [row(), row({ shellId: 'sh2', awaitingInput: true })] }
    expect(shellRosterOf(views).awaitingInput).toBe(true)
  })
})
