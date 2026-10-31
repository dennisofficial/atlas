import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { act } from 'react'

import { family, pullRequest, RowHarness } from './thread-row-render'
import { sessionOf, threadOf } from './fixtures'

let view: RowHarness
beforeEach(async () => {
  view = new RowHarness()
  await view.start()
})
afterEach(async () => {
  await view.stop()
})
const popup = () =>
  document.querySelector<HTMLElement>('[data-slot="popover-content"][data-open]') ??
  document.querySelector<HTMLElement>('[data-slot="hover-card-content"][data-open]')

async function escapeFrom(element: HTMLElement) {
  await act(async () =>
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  )
}

async function showDetails(threadId: string) {
  const button = view
    .link(threadId)
    .parentElement?.querySelector<HTMLButtonElement>('button[aria-label="Thread details"]')
  if (!button) throw new Error(`Missing details for ${threadId}`)
  await act(async () => {
    button.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }))
    button.click()
  })
  return button
}

describe('shared row details access', () => {
  it('focus-manages explicit details links and returns focus without reopening either card', async () => {
    await view.render()
    const button = view
      .link('main')
      .parentElement?.querySelector<HTMLButtonElement>('button[aria-label="Thread details"]')
    if (!button) throw new Error('Missing Details button')
    await act(async () => {
      button.focus()
      button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      button.click()
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    const card = popup()
    const firstPr = card?.querySelector<HTMLAnchorElement>(
      'a[href="https://github.com/owner/atlas/pull/1"]',
    )
    if (!card || !firstPr) throw new Error('Missing explicit PR details')
    expect(card.dataset.slot).toBe('popover-content')
    expect(card.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).toBe(firstPr)
    expect(card.querySelector('section')?.className).toContain('overflow-y-auto')
    let activated = false
    firstPr.addEventListener('click', (event) => {
      event.preventDefault()
      activated = true
    })
    await act(async () => firstPr.click())
    expect(activated).toBe(true)
    await escapeFrom(firstPr)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400))
    })
    expect(document.activeElement).toBe(button)
    expect(popup()).toBeNull()
    expect(button.getAttribute('aria-expanded')).toBe('false')
    await act(async () => view.link('main').focus())
    expect(popup()?.dataset.slot).toBe('hover-card-content')
  })

  it('gives PR titles a separate full-width row above wrapping state and check metadata', async () => {
    await view.render({
      states: [
        {
          ...pullRequest(2),
          state: 'open',
          checksRunning: 0,
          checksPassed: 15,
          checksFailed: 2,
          mergeable: false,
        },
      ],
    })
    await showDetails('main')
    const card = popup()
    const link = card?.querySelector<HTMLAnchorElement>(
      'a[href="https://github.com/owner/atlas/pull/2"]',
    )
    const titleRow = link?.closest('[data-pr-detail="title"]')
    const entry = titleRow?.parentElement
    const metadataRow = entry?.querySelector('[data-pr-detail="metadata"]')
    expect(entry?.dataset.prDetail).toBe('entry')
    expect(entry?.classList.contains('flex-col')).toBe(true)
    expect(titleRow?.nextElementSibling).toBe(metadataRow)
    expect(titleRow?.textContent).toContain('Fix 2')
    expect(titleRow?.textContent).not.toContain('passed')
    expect(titleRow?.querySelector('[aria-label="0 running, 15 passed, 2 failed"]')).toBeNull()
    expect(metadataRow?.querySelector('a')).toBeNull()
    expect(metadataRow?.textContent).toContain('15 passed')
    expect(metadataRow?.textContent).toContain('2 failed')
    expect(metadataRow?.querySelector('[aria-label="Merge conflicts"]')).not.toBeNull()
  })

  it('keeps the inline merged label but shows all available checks in merged PR details', async () => {
    const thread = threadOf({
      id: 'merged',
      title: 'Merged thread',
      pullRequests: [
        { ...pullRequest(9), state: 'merged', checksRunning: 0, checksPassed: 15, checksFailed: 2 },
      ],
    })
    await view.render({ session: sessionOf(thread) })
    expect(view.link('merged').textContent).toContain('merged')
    expect(view.link('merged').textContent).not.toContain('15 passed')
    await showDetails('merged')
    expect(popup()?.querySelector('[aria-label="0 running, 15 passed, 2 failed"]')).not.toBeNull()
    expect(popup()?.textContent).toContain('15 passed')
    expect(popup()?.textContent).toContain('2 failed')
    await escapeFrom(popup() ?? view.link('merged'))
    await act(async () => view.link('merged').focus())
    expect(popup()?.dataset.slot).toBe('hover-card-content')
    expect(popup()?.textContent).toContain('15 passed')
    expect(popup()?.textContent).toContain('2 failed')
  })

  it('waits for the shared 350ms hover delay before revealing details', async () => {
    await view.render()
    const trigger = view.link('main').parentElement
    if (!trigger) throw new Error('Missing hover trigger')
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }))
    })
    expect(popup()).toBeNull()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 380))
    })
    expect(popup()?.textContent).toContain('Own pull requests')
  })

  it('opens on keyboard focus and Escape dismisses without navigating or losing selection', async () => {
    await view.render()
    await act(async () => view.link('main').focus())
    expect(popup()?.textContent).toContain('Own pull requests')
    expect(popup()?.textContent).toContain('anthropic/claude-opus-4-6')
    expect(popup()?.textContent).toContain('Created')
    expect(popup()?.textContent).toContain('updated')
    expect(popup()?.textContent).toContain('Project')
    expect(popup()?.textContent).toContain('topic')
    await escapeFrom(view.link('main'))
    expect(popup()).toBeNull()
    expect(document.activeElement).toBe(view.link('main'))
    expect(view.link('main').getAttribute('aria-current')).toBe('page')
  })

  it('provides an explicit touch/click details action and leaves mutations outside the popup', async () => {
    await view.render()
    const button = await showDetails('mate')
    expect(button.closest('a')).toBeNull()
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(document.getElementById(button.getAttribute('aria-controls') ?? '')).not.toBeNull()
    expect(popup()?.textContent).toContain('Teammate of')
    expect(popup()?.textContent).toContain('Main title')
    for (const number of [3, 4, 5]) expect(popup()?.textContent).toContain(`Fix ${number}`)
    expect(popup()?.querySelector('[aria-label="Archive thread"]')).toBeNull()
    expect(
      view.link('mate').parentElement?.querySelector('[aria-label="Archive thread"]'),
    ).not.toBeNull()
    await escapeFrom(button)
    expect(button.getAttribute('aria-expanded')).toBe('false')
  })

  it('shows all own PRs with titles, state, checks and conflicts and explains collapsed teammate aggregation', async () => {
    await view.render({
      active: null,
      states: [
        {
          ...pullRequest(2),
          state: 'open',
          checksRunning: 0,
          checksPassed: 3,
          checksFailed: 1,
          mergeable: false,
        },
      ],
    })
    await showDetails('main')
    expect(popup()?.textContent).toContain('Fix 1')
    expect(popup()?.textContent).toContain('Fix 2')
    expect(popup()?.textContent).toContain('Collapsed summary includes unique pull requests')
    expect(popup()?.textContent).toContain('Teammate title')
    expect(popup()?.textContent).toContain('Completed title')
    expect(popup()?.querySelector('[aria-label="0 running, 3 passed, 1 failed"]')).not.toBeNull()
    expect(popup()?.querySelector('[aria-label="Merge conflicts"]')).not.toBeNull()
  })

  it('keeps borrowed-only PRs visible when their owner is absent from the teammate list', async () => {
    const thread = threadOf({
      id: 'borrowed',
      title: 'Borrowed main',
      pullRequests: [
        {
          ...pullRequest(42),
          via: { threadId: 'missing-agent', title: 'Worker not in session tree' },
        },
      ],
    })
    await view.render({ active: 'borrowed', session: sessionOf(thread) })
    expect(view.link('borrowed').textContent).toContain('#42')
    await showDetails('borrowed')
    expect(popup()?.textContent).toContain('Pull requests from other threads')
    expect(popup()?.textContent).toContain('Fix 42')
    expect(popup()?.textContent).toContain('From Worker not in session tree')
    expect(popup()?.textContent).toContain('No pull requests')
    await view.render({
      active: 'borrowed',
      session: sessionOf({
        ...thread,
        pullRequests: [{ ...pullRequest(42), via: { threadId: 'missing-agent', title: null } }],
      }),
    })
    expect(popup()?.textContent).toContain('From missing-agent')
  })

  it('uses the actual intermediate parent for nested teammates rather than the family main', async () => {
    const nested = sessionOf(family.mainThread, [
      sessionOf(threadOf({ id: 'middle', title: 'Intermediate owner' }), [
        sessionOf(threadOf({ id: 'nested', title: 'Nested worker' })),
      ]),
    ])
    await view.render({ active: 'nested', session: nested })
    await showDetails('nested')
    const owner = popup()?.querySelector('a[href="/threads/middle"]')
    expect(owner?.textContent).toBe('Intermediate owner')
    expect(popup()?.querySelector('a[href="/threads/main"]')).toBeNull()
  })

  it('does not turn partial or absent check counts into a green passing result', async () => {
    const thread = threadOf({
      id: 'partial',
      title: 'Partial checks',
      pullRequests: [{ ...pullRequest(1), checksPassed: 3 }],
    })
    await view.render({ session: sessionOf(thread) })
    expect(view.link('partial').textContent).toContain('Checks unknown')
    expect(view.link('partial').querySelector('.text-success')).toBeNull()
    await showDetails('partial')
    expect(popup()?.textContent).toContain('Checks incomplete')
    expect(popup()?.querySelector('.text-success')).toBeNull()
  })
})
