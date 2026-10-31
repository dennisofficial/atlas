import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { act, type ReactNode } from 'react'
import type { Root } from 'react-dom/client'

import { SidebarProvider } from '@dltech/atlas-ui/components/sidebar'
import type { PrStateWire, WireThread } from '@dltech/atlas-wire/web'
import { ESidebarDensity, useSidebarDensity } from '../shell-density'
import { SidebarPrStatesProvider } from '../shell-sidebar-pr-states'
import { ThreadRow } from '../shell-thread-row'
import { ThreadActionsContext } from '../thread-actions-context'
import { sessionOf, threadOf } from './fixtures'

export const pullRequest = (number: number): NonNullable<WireThread['pullRequests']>[number] => ({
  number,
  repo: 'owner/atlas',
  url: `https://github.com/owner/atlas/pull/${number}`,
  branch: 'topic',
  state: 'open',
  title: `Fix ${number}`,
})
export const runStatus = (
  changes: Partial<NonNullable<WireThread['status']>> = {},
): NonNullable<WireThread['status']> => ({
  working: false,
  awaiting: null,
  lastOutcome: null,
  podState: 'running',
  lastAssistantSeq: 0,
  ...changes,
})
export const family = sessionOf(
  threadOf({
    id: 'main',
    title: 'Main title',
    worktree: { path: '/repo', branch: 'topic' },
    model: { ref: 'anthropic/claude-opus-4-6' },
    pullRequests: [
      pullRequest(1),
      pullRequest(2),
      {
        ...pullRequest(3),
        repo: 'github.com/OWNER/ATLAS',
        via: { threadId: 'mate', title: 'Teammate title' },
      },
    ],
    status: runStatus(),
  }),
  [
    sessionOf(
      threadOf({
        id: 'mate',
        title: 'Teammate title',
        pullRequests: [pullRequest(3), pullRequest(4), pullRequest(5)],
        status: runStatus({ working: true }),
      }),
    ),
    sessionOf(
      threadOf({
        id: 'done',
        title: 'Completed title',
        pullRequests: [pullRequest(6)],
        status: runStatus({ lastOutcome: 'completed', podState: 'parked' }),
      }),
    ),
  ],
)

function DensityChoice() {
  const { setDensity } = useSidebarDensity()
  return (
    <>
      <button type="button" onClick={() => setDensity(ESidebarDensity.Compact)}>
        Compact
      </button>
      <button type="button" onClick={() => setDensity(ESidebarDensity.Comfortable)}>
        Comfortable
      </button>
    </>
  )
}

export class RowHarness {
  private root: Root | undefined
  container: HTMLDivElement | undefined
  archived: WireThread[] = []

  async start() {
    GlobalRegistrator.register()
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    const { createRoot } = await import('react-dom/client')
    this.container = document.createElement('div')
    document.body.append(this.container)
    this.root = createRoot(this.container)
  }

  async stop() {
    await act(async () => this.root?.unmount())
    this.container?.remove()
    await GlobalRegistrator.unregister()
  }

  async render({
    active = 'main',
    session = family,
    states = [],
    children,
  }: {
    active?: string | null
    session?: typeof family
    states?: PrStateWire[]
    children?: ReactNode
  } = {}) {
    await act(async () =>
      this.root?.render(
        <SidebarProvider>
          <ThreadActionsContext.Provider
            value={{
              onToggleArchive: (thread) => {
                this.archived.push(thread)
              },
            }}
          >
            <SidebarPrStatesProvider states={states}>
              <DensityChoice />
              <ul>
                <ThreadRow session={session} projectName="atlas" activeThreadId={active} />
              </ul>
              {children}
            </SidebarPrStatesProvider>
          </ThreadActionsContext.Provider>
        </SidebarProvider>,
      ),
    )
  }

  find<T extends Element = HTMLElement>(selector: string): T {
    const element = this.container?.querySelector<T>(selector)
    if (!element) throw new Error(`Missing ${selector}`)
    return element
  }

  link(id: string) {
    return this.find<HTMLAnchorElement>(`a[href="/threads/${id}"]`)
  }
  async click(selector: string) {
    await act(async () => this.find<HTMLElement>(selector).click())
  }
  async density(value: ESidebarDensity) {
    await this.click(
      value === ESidebarDensity.Compact ? 'button:first-child' : 'button:nth-child(2)',
    )
  }
}
