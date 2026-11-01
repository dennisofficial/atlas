import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'

import { SidebarProvider } from '@dltech/atlas-ui/components/sidebar'
import { githubPrStatesInputSchema } from '@dltech/atlas-wire/web'

import {
  installObservationIntersections,
  observationSourceRig,
} from '@/features/threads/data/__tests__/pr-observation.fixture'

import { ThreadList } from '../shell-thread-list'
import { ThreadActionsContext } from '../thread-actions-context'
import { sessionOf, threadOf } from './fixtures'
import { family } from './thread-row-render'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await GlobalRegistrator.unregister()
})

function findElement(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector)
  if (element === null) throw new Error(`Missing ${selector}`)
  return element
}

const numbers = (source: ReturnType<typeof observationSourceRig>) =>
  source.observations().map((target) => target.number)

describe('sidebar visible summary and card observations', () => {
  it('reserves inline PR140 and other visible family targets while its 140-entry Details card is open', async () => {
    const intersections = installObservationIntersections()
    const source = observationSourceRig()
    const { createRoot } = await import('react-dom/client')
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const parent = sessionOf(
      threadOf({
        id: 'history',
        title: 'Current work with old pull requests',
        updatedAt: new Date().toISOString(),
        pullRequests: Array.from({ length: 140 }, (_, index) => ({
          number: index + 1,
          repo: 'owner/repo',
          branch: 'topic',
          url: `https://github.com/owner/repo/pull/${index + 1}`,
          state: index === 139 ? 'open' : 'merged',
        })),
      }),
      [sessionOf(threadOf({ id: 'child', title: 'Child without a pull request' }))],
    )
    const others = [141, 142].map((number) =>
      sessionOf(
        threadOf({
          id: `other-${number}`,
          title: `Other family ${number}`,
          updatedAt: new Date().toISOString(),
          pullRequests: [
            {
              number,
              repo: 'owner/repo',
              branch: `other-${number}`,
              state: 'open',
              url: `https://github.com/owner/repo/pull/${number}`,
            },
          ],
        }),
      ),
    )
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    try {
      await act(async () =>
        root.render(
          <SidebarProvider>
            <ThreadActionsContext.Provider value={{ onToggleArchive: () => {} }}>
              <ThreadList
                entries={[{ project: null, sessions: [parent, ...others] }]}
                activeThreadId={null}
                subscribe={source.subscribe}
              />
            </ThreadActionsContext.Provider>
          </SidebarProvider>,
        ),
      )
      const main = findElement('a[href="/threads/history"]')
      expect(main.textContent).toContain('#140')
      expect(main.textContent).toContain('+139')
      expect(main.querySelector('[aria-label="Pull request open"]')).not.toBeNull()
      expect(container.querySelector('a[href="/threads/child"]')).toBeNull()
      await act(async () =>
        intersections.emit([
          { element: main, visible: true },
          { element: findElement('a[href="/threads/other-141"]'), visible: true },
          { element: findElement('a[href="/threads/other-142"]'), visible: true },
        ]),
      )
      expect(numbers(source)).toEqual([140, 141, 142])
      const details = main.parentElement?.querySelector<HTMLButtonElement>(
        'button[aria-label="Thread details"]',
      )
      if (details === null || details === undefined)
        throw new Error('Missing explicit details control')
      await act(async () => details.click())
      const card = findElement(
        '[data-slot="popover-content"] section[aria-label="Scrollable thread details"]',
      )
      expect(card.querySelectorAll('[data-pr-detail="entry"]')).toHaveLength(140)
      await act(async () => intersections.emit([{ element: card, visible: true }]))
      expect(numbers(source)).toHaveLength(128)
      expect(numbers(source)).toContain(1)
      expect(numbers(source)).toContain(140)
      expect(numbers(source)).toContain(141)
      expect(numbers(source)).toContain(142)
      expect(githubPrStatesInputSchema.safeParse({ observe: source.observations() }).success).toBe(
        true,
      )
      expect(
        source
          .observations()
          .every((target) => Object.keys(target).sort().join(',') === 'number,repo'),
      ).toBe(true)
      expect(source.active()).toBe(1)
      expect(main.textContent).toContain('#140')
      await act(async () => details.click())
      expect(numbers(source)).toEqual([140, 141, 142])
      expect(source.peak()).toBe(1)
    } finally {
      await act(async () => root.unmount())
      container.remove()
      intersections.restore()
    }
    expect(source.active()).toBe(0)
  })

  it('observes only the visible latest row summary, adds all shown parent-card PRs, and releases on close/offscreen/collapse', async () => {
    const intersections = installObservationIntersections()
    const source = observationSourceRig()
    const { createRoot } = await import('react-dom/client')
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const currentFamily = {
      ...family,
      mainThread: { ...family.mainThread, updatedAt: new Date().toISOString() },
    }
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    try {
      await act(async () =>
        root.render(
          <SidebarProvider>
            <ThreadActionsContext.Provider value={{ onToggleArchive: () => {} }}>
              <ThreadList
                entries={[{ project: null, sessions: [currentFamily] }]}
                activeThreadId="main"
                subscribe={source.subscribe}
              />
            </ThreadActionsContext.Provider>
          </SidebarProvider>,
        ),
      )
      expect(intersections.observers).toHaveLength(1)
      expect(numbers(source)).toEqual([])
      const main = findElement('a[href="/threads/main"]')
      await act(async () => intersections.emit([{ element: main, visible: true }]))
      expect(numbers(source)).toEqual([2])
      await act(async () => main.focus())
      const hover = findElement(
        '[data-slot="hover-card-content"] section[aria-label="Scrollable thread details"]',
      )
      await act(async () => intersections.emit([{ element: hover, visible: true }]))
      expect(numbers(source)).toEqual([1, 2, 3, 4, 5, 6])
      await act(async () =>
        main.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
      )
      expect(numbers(source)).toEqual([2])
      const details = main.parentElement?.querySelector<HTMLButtonElement>(
        'button[aria-label="Thread details"]',
      )
      if (details === null || details === undefined)
        throw new Error('Missing explicit details control')
      await act(async () => details.click())
      const explicit = findElement(
        '[data-slot="popover-content"] section[aria-label="Scrollable thread details"]',
      )
      await act(async () => intersections.emit([{ element: explicit, visible: true }]))
      expect(numbers(source)).toEqual([1, 2, 3, 4, 5, 6])
      await act(async () => details.click())
      expect(numbers(source)).toEqual([2])
      await act(async () => intersections.emit([{ element: main, visible: false }]))
      expect(numbers(source)).toEqual([])
      await act(async () => intersections.emit([{ element: main, visible: true }]))
      const disclosure = main.parentElement?.querySelector<HTMLButtonElement>(
        'button[aria-expanded][aria-controls]:not([aria-label="Thread details"])',
      )
      if (disclosure === null || disclosure === undefined)
        throw new Error('Missing teammate disclosure')
      await act(async () => disclosure.click())
      expect(numbers(source)).toEqual([6])
      expect(container.querySelector('a[href="/threads/mate"]')).toBeNull()
      expect(source.active()).toBe(1)
      expect(source.peak()).toBe(1)
      expect(intersections.observers).toHaveLength(1)
    } finally {
      await act(async () => root.unmount())
      container.remove()
      intersections.restore()
    }
    expect(source.active()).toBe(0)
  })
})
