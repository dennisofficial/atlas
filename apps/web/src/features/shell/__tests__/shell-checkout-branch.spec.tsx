import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { act } from 'react'

import { pullRequest, RowHarness } from './thread-row-render'
import { sessionOf, threadOf } from './fixtures'

let view: RowHarness
beforeEach(async () => {
  view = new RowHarness()
  await view.start()
})
afterEach(async () => {
  await view.stop()
})

const checkout = { path: '/repo', branch: 'switched', detached: false }
const popup = () => document.querySelector<HTMLElement>('[data-slot="popover-content"][data-open]')

async function showDetails(threadId: string) {
  const button = view
    .link(threadId)
    .parentElement?.querySelector<HTMLButtonElement>('button[aria-label="Thread details"]')
  if (!button) throw new Error(`Missing details for ${threadId}`)
  await act(async () => {
    button.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }))
    button.click()
  })
}

describe('row branch label', () => {
  it('shows the observed checkout branch over the worktree branch when no PR exists', async () => {
    const thread = threadOf({ id: 'a', worktree: { path: '/repo', branch: 'old' }, checkout })
    await view.render({ session: sessionOf(thread), active: 'a' })
    expect(view.link('a').textContent).toContain('switched')
    expect(view.link('a').textContent).not.toContain('old')
  })

  it('shows the pull request instead of the branch when one exists', async () => {
    const thread = threadOf({ id: 'a', checkout, pullRequests: [pullRequest(7)] })
    await view.render({ session: sessionOf(thread), active: 'a' })
    expect(view.link('a').textContent).toContain('#7')
    expect(view.link('a').textContent).not.toContain('switched')
  })

  it('shows detached for a detached head', async () => {
    const thread = threadOf({ id: 'd', checkout: { path: '/repo', branch: null, detached: true } })
    await view.render({ session: sessionOf(thread), active: 'd' })
    expect(view.link('d').textContent).toContain('detached')
  })

  it('shows no branch yet for a non-git directory instead of a stale worktree branch', async () => {
    const thread = threadOf({
      id: 'n',
      worktree: { path: '/repo', branch: 'stale' },
      checkout: { path: '/tmp', branch: null, detached: false },
    })
    await view.render({ session: sessionOf(thread), active: 'n' })
    expect(view.link('n').textContent).toContain('No branch yet')
    expect(view.link('n').textContent).not.toContain('stale')
  })
})

describe('details popover branch', () => {
  it('shows the current branch even when a pull request exists', async () => {
    const thread = threadOf({ id: 'a', checkout, pullRequests: [pullRequest(7)] })
    await view.render({ session: sessionOf(thread), active: 'a' })
    await showDetails('a')
    expect(popup()?.textContent).toContain('switched')
  })

  it('omits the branch row for a directory outside git', async () => {
    const thread = threadOf({
      id: 'n',
      worktree: { path: '/repo', branch: 'stale' },
      checkout: { path: '/tmp', branch: null, detached: false },
    })
    await view.render({ session: sessionOf(thread), active: 'n' })
    await showDetails('n')
    expect(popup()?.textContent).not.toContain('Branch')
    expect(popup()?.textContent).not.toContain('stale')
  })
})
