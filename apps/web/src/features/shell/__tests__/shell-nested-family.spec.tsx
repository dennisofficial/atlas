import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { act } from 'react'

import { ESidebarDensity } from '../shell-density'
import { nestedFamily, pullRequest, RowHarness } from './thread-row-render'
import { threadOf } from './fixtures'

let view: RowHarness
beforeEach(async () => {
  view = new RowHarness()
  await view.start()
})
afterEach(async () => {
  await view.stop()
})

const popup = () =>
  document.querySelector<HTMLElement>('[data-slot="hover-card-content"][data-open]')
const ownEntries = () =>
  [...(popup()?.querySelectorAll('h3') ?? [])]
    .find((heading) => heading.textContent === 'Own pull requests')
    ?.nextElementSibling?.querySelectorAll('[data-pr-detail="entry"]')

function toggleOf(id: string): HTMLButtonElement {
  const button = view
    .link(id)
    .parentElement?.querySelector<HTMLButtonElement>(
      'button[aria-controls][aria-expanded]:not([aria-label="Thread details"])',
    )
  if (!button) throw new Error(`Missing disclosure for ${id}`)
  return button
}

async function toggle(id: string) {
  await act(async () => toggleOf(id).click())
}

async function focusDetails(id: string) {
  const previous = document.activeElement
  if (previous instanceof HTMLElement) await act(async () => previous.blur())
  await act(async () => view.link(id).focus())
}

describe('recursive shared thread rows', () => {
  it('reveals the active leaf ancestor chain and lets its middle parent collapse independently of selection and density', async () => {
    await view.render({ active: 'leaf', session: nestedFamily })
    const rootToggle = toggleOf('main')
    const middleToggle = toggleOf('middle')
    expect(rootToggle.getAttribute('aria-expanded')).toBe('true')
    expect(middleToggle.getAttribute('aria-label')).toBe('Hide 1 teammate')
    expect(middleToggle.closest('a')).toBeNull()
    const rootChildren = document.getElementById(rootToggle.getAttribute('aria-controls') ?? '')
    const middleChildren = document.getElementById(middleToggle.getAttribute('aria-controls') ?? '')
    expect(rootChildren?.contains(view.link('middle'))).toBe(true)
    expect(middleChildren?.contains(view.link('leaf'))).toBe(true)
    expect(view.link('leaf').getAttribute('aria-current')).toBe('page')
    await toggle('middle')
    expect(view.container?.querySelector('a[href="/threads/leaf"]')).toBeNull()
    expect(toggleOf('main').getAttribute('aria-expanded')).toBe('true')
    expect(view.link('main').textContent).toContain('+1')
    expect(view.link('middle').textContent).toContain('+3')
    await view.render({ active: 'leaf', session: nestedFamily })
    await view.density(ESidebarDensity.Compact)
    expect(toggleOf('middle').getAttribute('aria-expanded')).toBe('false')
    expect(view.link('main').querySelector('[data-pr-count]')?.textContent).toBe('2')
    expect(view.link('middle').querySelector('[data-pr-count]')?.textContent).toBe('4')
    await toggle('middle')
    expect(view.link('leaf').getAttribute('aria-current')).toBe('page')
    expect(view.link('middle').querySelector('[data-pr-count]')?.textContent).toBe('3')
    expect(view.link('leaf').querySelector('[data-pr-count]')).toBeNull()
    await toggle('main')
    expect(view.container?.querySelector('a[href="/threads/middle"]')).toBeNull()
    expect(view.container?.querySelector('a[href="/threads/leaf"]')).toBeNull()
    expect(view.link('main').querySelector('[data-pr-count]')?.textContent).toBe('6')
    await view.density(ESidebarDensity.Comfortable)
    expect(toggleOf('main').getAttribute('aria-expanded')).toBe('false')
    expect(view.link('main').textContent).toContain('+5')
  })

  it('reveals each selected parent children and reopens ancestors on a newly active leaf', async () => {
    await view.render({ active: 'main', session: nestedFamily })
    expect(view.link('middle')).not.toBeNull()
    expect(view.container?.querySelector('a[href="/threads/leaf"]')).toBeNull()
    expect(toggleOf('middle').getAttribute('aria-expanded')).toBe('false')
    view.link('middle').addEventListener('click', (event) => event.preventDefault())
    await view.click('a[href="/threads/middle"]')
    expect(view.link('leaf')).not.toBeNull()
    await view.render({ active: 'middle', session: nestedFamily })
    expect(view.link('middle').getAttribute('aria-current')).toBe('page')
    await toggle('middle')
    await view.render({ active: 'middle', session: nestedFamily })
    expect(view.container?.querySelector('a[href="/threads/leaf"]')).toBeNull()
    await toggle('main')
    await view.render({ active: 'leaf', session: nestedFamily })
    expect(view.link('leaf').getAttribute('aria-current')).toBe('page')
    expect(toggleOf('main').getAttribute('aria-expanded')).toBe('true')
    expect(toggleOf('middle').getAttribute('aria-expanded')).toBe('true')
    await view.render({ active: 'main', session: nestedFamily })
    expect(toggleOf('main').getAttribute('aria-expanded')).toBe('true')
    expect(toggleOf('middle').getAttribute('aria-expanded')).toBe('false')
  })

  it('lists middle children with live metadata and keeps actual parent ownership at every level', async () => {
    await view.render({
      active: 'leaf',
      session: nestedFamily,
      states: [
        { ...pullRequest(6), checksRunning: 0, checksPassed: 2, checksFailed: 1, mergeable: false },
      ],
    })
    await focusDetails('middle')
    expect(popup()?.querySelector('a[href="/threads/main"]')?.textContent).toBe('Main title')
    expect(ownEntries()).toHaveLength(3)
    const leaf = popup()?.querySelector('a[href="/threads/leaf"]')?.closest('li')
    expect(leaf?.textContent).toContain('Fix 6')
    expect(leaf?.querySelector('[aria-label="Waiting for you"]')).not.toBeNull()
    expect(leaf?.querySelector('[aria-label="0 running, 2 passed, 1 failed"]')).not.toBeNull()
    expect(leaf?.querySelector('[aria-label="Merge conflicts"]')).not.toBeNull()
    await focusDetails('leaf')
    expect(popup()?.querySelector('a[href="/threads/middle"]')?.textContent).toBe('Middle title')
    expect(popup()?.querySelector('a[href="/threads/main"]')).toBeNull()
    expect(ownEntries()).toHaveLength(1)
    await focusDetails('main')
    expect(popup()?.querySelector('a[href="/threads/leaf"]')?.closest('li')?.textContent).toContain(
      'Teammate of Middle title',
    )
    expect(ownEntries()).toHaveLength(2)
    await toggle('middle')
    await focusDetails('middle')
    expect(popup()?.textContent).toContain('Collapsed summary includes unique pull requests')
    expect(ownEntries()).toHaveLength(3)
    expect(popup()?.querySelector('a[href="/threads/leaf"]')).not.toBeNull()
  })

  it('preserves inherited known owners outside the root family for nested shared-branch summaries and details', async () => {
    const otherRoot = threadOf({
      id: 'other-root',
      title: 'Other family',
      repo: 'owner/atlas',
      worktree: { path: '/repo', branch: 'topic' },
      pullRequests: [pullRequest(99)],
    })
    await view.render({
      active: 'leaf',
      session: nestedFamily,
      knownThreads: [otherRoot],
      states: [pullRequest(99)],
    })
    await view.density(ESidebarDensity.Compact)
    expect(view.link('main').querySelector('[data-pr-count]')?.textContent).toBe('2')
    expect(view.link('middle').querySelector('[data-pr-count]')?.textContent).toBe('3')
    expect(view.link('leaf').querySelector('[data-pr-count]')).toBeNull()
    for (const id of ['main', 'middle', 'leaf']) {
      await focusDetails(id)
      expect(popup()?.textContent).not.toContain('Fix 99')
    }
    await toggle('main')
    expect(view.link('main').querySelector('[data-pr-count]')?.textContent).toBe('6')
    await focusDetails('main')
    expect(popup()?.textContent).not.toContain('Fix 99')
  })

  it('uses the complete root family context for shared-branch live discovery in nested row and details summaries', async () => {
    const states = Array.from({ length: 6 }, (_, index) => ({
      ...pullRequest(index + 1),
      state: 'open' as const,
      checksRunning: 0,
      checksPassed: 3,
      checksFailed: 0,
      mergeable: true,
    }))
    await view.render({ active: 'leaf', session: nestedFamily, states })
    await view.density(ESidebarDensity.Compact)
    expect(view.link('main').querySelector('[data-pr-count]')?.textContent).toBe('2')
    expect(view.link('middle').querySelector('[data-pr-count]')?.textContent).toBe('3')
    expect(view.link('leaf').querySelector('[data-pr-count]')).toBeNull()
    for (const [id, count] of [
      ['main', 2],
      ['middle', 3],
      ['leaf', 1],
    ] as const) {
      await focusDetails(id)
      expect(ownEntries()).toHaveLength(count)
    }
    expect(popup()?.textContent).not.toContain('Fix 1')
    expect(popup()?.textContent).not.toContain('Fix 5')
    await toggle('middle')
    expect(view.link('middle').querySelector('[data-pr-count]')?.textContent).toBe('4')
    await toggle('main')
    expect(view.link('main').querySelector('[data-pr-count]')?.textContent).toBe('6')
    await toggle('main')
    await focusDetails('middle')
    expect(ownEntries()).toHaveLength(3)
    expect(popup()?.textContent).not.toContain('Fix 1')
    expect(popup()?.textContent).not.toContain('Fix 2')
    await act(async () => {
      view
        .link('middle')
        .parentElement?.querySelector<HTMLButtonElement>('[aria-label="Archive thread"]')
        ?.click()
    })
    expect(view.archived).toEqual([nestedFamily.teammates[0]?.mainThread])
  })
})
