import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { ESidebarDensity } from '../shell-density'
import { pullRequest, RowHarness, runStatus } from './thread-row-render'
import { sessionOf, threadOf } from './fixtures'

let view: RowHarness
beforeEach(async () => {
  view = new RowHarness()
  await view.start()
})
afterEach(async () => {
  await view.stop()
})

describe('shared sidebar row interactions', () => {
  it('renders full main and completed teammate rows always expanded and follows a different active family member', async () => {
    await view.render()
    expect(view.link('done').textContent).toContain('#6')
    expect(view.link('mate')).not.toBeNull()
    expect(view.link('done')).not.toBeNull()
    expect(view.container?.querySelector('button[aria-label*="teammate"]')).toBeNull()
    expect(view.link('main').getAttribute('aria-current')).toBe('page')
    expect(view.link('main').textContent).not.toContain('+5')
    await view.render({ active: 'main' })
    expect(view.link('mate')).not.toBeNull()
    await view.render({ active: 'mate' })
    expect(view.link('mate').getAttribute('aria-current')).toBe('page')
    await view.render({ active: 'main' })
    view.link('main').addEventListener('click', (event) => event.preventDefault())
    await view.click('a[href="/threads/main"]')
    expect(view.link('main').getAttribute('aria-current')).toBe('page')
    expect(view.link('mate')).not.toBeNull()
  })

  it('changes all rows to one line with neutral own 2/3/1 badges and never aggregates', async () => {
    await view.render()
    expect(view.link('main').textContent).toContain('#2')
    expect(view.link('mate').textContent).toContain('#5')
    await view.density(ESidebarDensity.Compact)
    expect(view.link('main').querySelector('[data-pr-count]')?.textContent).toBe('2')
    expect(view.link('mate').querySelector('[data-pr-count]')?.textContent).toBe('3')
    expect(view.link('done').querySelector('[data-pr-count]')).toBeNull()
    for (const id of ['main', 'mate', 'done']) {
      expect(view.link(id).querySelector('[data-thread-line="secondary"]')).toBeNull()
      expect(view.link(id).querySelector('time')).toBeNull()
      expect(view.link(id).textContent).not.toContain('#')
    }
    expect(view.link('main').querySelector('[data-pr-count]')?.className).not.toContain('warning')
    await view.density(ESidebarDensity.Comfortable)
    expect(view.link('mate')).not.toBeNull()
    expect(view.link('main').textContent).toContain('+1')
    expect(view.link('mate').textContent).toContain('+2')
  })

  it('keeps run status independent of live PR state, CI and conflicts without opening the thread', async () => {
    await view.render({ active: null })
    const state = {
      ...pullRequest(6),
      state: 'open' as const,
      checksRunning: 2,
      checksPassed: 3,
      checksFailed: 0,
      mergeable: null,
    }
    await view.render({ active: null, states: [state] })
    expect(view.link('done').querySelector('[aria-label="Parked"]')).not.toBeNull()
    expect(
      view.link('done').querySelector('[aria-label="2 running, 3 passed, 0 failed"]'),
    ).not.toBeNull()
    await view.render({
      active: null,
      states: [{ ...state, checksRunning: 0, checksFailed: 1, mergeable: false }],
    })
    expect(
      view.link('done').querySelector('[aria-label="0 running, 3 passed, 1 failed"]'),
    ).not.toBeNull()
    expect(view.link('done').querySelector('[aria-label="Merge conflicts"]')).not.toBeNull()
    await view.render({ active: null, states: [{ ...state, state: 'merged', checksRunning: 0 }] })
    expect(view.link('done').querySelector('[aria-label="Pull request merged"]')).not.toBeNull()
    expect(view.link('done').querySelector('[aria-label="Parked"]')).not.toBeNull()
  })

  it('keeps unread inside the status icon, with local identity, pin and archive/unarchive actions', async () => {
    const thread = threadOf({
      id: 'local',
      title: 'Local title',
      runner: 'local',
      pinnedAt: '2026-10-01',
      status: runStatus({ lastAssistantSeq: 5, readSeq: 1 }),
      worktree: { path: '/repo', branch: 'worktree' },
    })
    await view.render({ active: null, session: sessionOf(thread) })
    const row = view.link('local')
    expect(row.querySelector('[data-thread-line="primary"] [aria-label="Unread"]')).not.toBeNull()
    expect(row.querySelector('[data-thread-line="secondary"] [aria-label="Unread"]')).toBeNull()
    expect(row.querySelector('[aria-label="This Mac"]')).not.toBeNull()
    expect(view.container?.querySelector('[aria-label="Pinned"]')).not.toBeNull()
    await view.click('button[aria-label="Archive thread"]')
    expect(view.archived).toEqual([thread])
    await view.render({ active: null, session: sessionOf({ ...thread, archivedAt: '2026-10-02' }) })
    await view.click('button[aria-label="Unarchive thread"]')
    expect(view.archived).toHaveLength(2)
    await view.density(ESidebarDensity.Compact)
    expect(
      view.link('local').querySelector('[data-thread-line="primary"] [aria-label="Unread"]'),
    ).not.toBeNull()
  })

  it('caps a total badge at 9+ and keeps no-PR branches badge-free', async () => {
    await view.render({
      session: sessionOf(
        threadOf({
          id: 'many',
          title: 'Many',
          pullRequests: Array.from({ length: 11 }, (_, index) => pullRequest(index + 1)),
        }),
      ),
    })
    await view.density(ESidebarDensity.Compact)
    expect(view.link('many').querySelector('[data-pr-count]')?.textContent).toBe('9+')
    await view.render({ session: sessionOf(threadOf({ id: 'branch', title: 'Branch' })) })
    expect(view.link('branch').querySelector('[aria-label="Worktree branch"]')).not.toBeNull()
    expect(view.link('branch').querySelector('[data-pr-count]')).toBeNull()
    await view.density(ESidebarDensity.Comfortable)
    expect(view.link('branch').textContent).toContain('No branch yet')
  })

  it('keeps missing run data idle instead of parked and distinguishes waiting, failed, starting and parked', async () => {
    const rows = [
      threadOf({ id: 'unknown' }),
      threadOf({ id: 'parked', status: runStatus({ podState: 'parked' }) }),
      threadOf({ id: 'starting', status: runStatus({ podState: 'booting' }) }),
      threadOf({ id: 'failed', status: runStatus({ lastOutcome: 'failed' }) }),
      threadOf({ id: 'waiting', status: runStatus({ awaiting: 'input' }) }),
    ]
    const expected = ['Idle', 'Parked', 'Starting pod', 'Failed', 'Waiting for you']
    for (const [index, thread] of rows.entries()) {
      await view.render({ session: sessionOf(thread) })
      expect(view.link(thread.id).querySelector(`[aria-label="${expected[index]}"]`)).not.toBeNull()
    }
  })
})
