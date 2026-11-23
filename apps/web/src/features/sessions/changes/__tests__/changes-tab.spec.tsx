import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { EChangeFileStatus, type SessionChangesOutput } from '@dltech/atlas-protocol'
import { act } from 'react'
import type { Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'

import { CloudApiError } from '@/lib/cloud-api'

import { paneValueFixture } from '../../panel/__tests__/fixture'
import { SessionPaneProvider, type SessionPaneValue } from '../../panel/pane-value'

const changes = { answer: undefined as SessionChangesOutput | Error | undefined }
const contentCalls: string[] = []

mock.module('@/features/sessions/changes/changes-api', () => ({
  fetchChanges: async () => {
    const answer = changes.answer
    if (answer instanceof Error) throw answer
    return answer ?? { checkouts: [] }
  },
  fetchChangeContent: async (args: { side: string }) => {
    contentCalls.push(args.side)
    return {
      url: `https://signed.test/${args.side}`,
      hash: args.side,
      size: 4,
      validUntil: 0,
    }
  },
}))

const { CheckoutChoiceProvider } = await import('../../checkouts/checkout-choice-context')
const { ChangesTab } = await import('../changes-tab')
const { EPaneOpen } = await import('../../panel/pane-open')

const realFetch = globalThis.fetch

const checkout = (overrides: Partial<SessionChangesOutput['checkouts'][number]> = {}) => ({
  checkoutId: 'co-1',
  repo: 'owner/atlas',
  worktreePath: '/work/app',
  base: 'main',
  updatedAt: Date.now(),
  files: [],
  ...overrides,
})

const file = (overrides: Record<string, unknown> = {}) => ({
  path: 'src/app.ts',
  oldPath: null,
  status: EChangeFileStatus.Modified,
  additions: 1,
  deletions: 1,
  binary: false,
  size: 8,
  baseHash: 'base',
  currentHash: 'current',
  ...overrides,
})

const roots = new Set<Root>()

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  globalThis.fetch = realFetch
  await unregisterDom()
})

beforeEach(() => {
  changes.answer = undefined
  contentCalls.length = 0
  globalThis.fetch = (async () => new Response('a\nb\n')) as typeof fetch
})

afterEach(async () => {
  for (const root of roots) await act(async () => root.unmount())
  roots.clear()
  window.localStorage.clear()
})

const wrap = (value: SessionPaneValue = paneValueFixture()) => (
  <SessionPaneProvider value={value}>
    <CheckoutChoiceProvider
      sessionId="ses-1"
      status={value.status}
      currentWorktreePath={value.checkouts.primary === null ? undefined : '/work/app'}
    >
      <ChangesTab />
    </CheckoutChoiceProvider>
  </SessionPaneProvider>
)

const render = (): string => renderToStaticMarkup(wrap())

const settle = async (): Promise<void> => {
  for (let round = 0; round < 4; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
  }
}

async function mount(value: SessionPaneValue = paneValueFixture()): Promise<HTMLDivElement> {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  const root = createRoot(container)
  roots.add(root)
  await act(async () => root.render(wrap(value)))
  await settle()
  return container
}

describe('ChangesTab', () => {
  it('says it is loading before the list answers', () => {
    expect(render()).toContain('Loading changes…')
  })

  it('says no snapshot exists yet, without promising anything', async () => {
    const text = (await mount()).textContent ?? ''
    expect(text).toContain('No changes yet')
    expect(text).not.toMatch(/coming|soon/i)
  })

  it('names the missing bucket when change storage answers 503', async () => {
    changes.answer = new CloudApiError({ message: 'no bucket configured', status: 503 })
    const text = (await mount()).textContent ?? ''
    expect(text).toContain('Change storage unavailable')
  })

  it('reports any other failure with its message', async () => {
    changes.answer = new CloudApiError({ message: 'the session is not yours', status: 403 })
    const text = (await mount()).textContent ?? ''
    expect(text).toContain('Changes unavailable')
    expect(text).toContain('the session is not yours')
  })

  it('shows the selected checkout', async () => {
    changes.answer = {
      checkouts: [
        checkout({ checkoutId: 'co-1', files: [file()] }),
        checkout({ checkoutId: 'co-2', worktreePath: '/work/wt', files: [file()] }),
      ],
    }
    const container = await mount()
    const sections = container.querySelectorAll('[data-changes-checkout]')
    expect(sections).toHaveLength(1)
    expect(sections[0]?.getAttribute('data-changes-checkout')).toBe('co-1')
    expect(container.textContent).not.toContain('/work/wt')
  })

  it('keeps the select when the chosen checkout has no changes', async () => {
    changes.answer = {
      checkouts: [
        checkout({ checkoutId: 'co-1', files: [] }),
        checkout({ checkoutId: 'co-2', worktreePath: '/work/wt', files: [file()] }),
      ],
    }
    const container = await mount()
    expect(container.querySelectorAll('[data-changes-checkout]')).toHaveLength(0)
    expect(container.querySelectorAll('[data-checkout-select]')).toHaveLength(1)
    expect(container.textContent).toContain('No changes yet')
  })

  it('remembers the chosen checkout', async () => {
    window.localStorage.setItem(
      'atlas:session-checkout',
      JSON.stringify({ 'ses-1': { checkoutId: 'co-2' } }),
    )
    changes.answer = {
      checkouts: [
        checkout({ checkoutId: 'co-1', files: [file()] }),
        checkout({ checkoutId: 'co-2', worktreePath: '/work/wt', files: [file()] }),
      ],
    }
    const container = await mount()
    const sections = container.querySelectorAll('[data-changes-checkout]')
    expect(sections[0]?.getAttribute('data-changes-checkout')).toBe('co-2')
  })

  it('falls back to the first when the remembered id is gone', async () => {
    window.localStorage.setItem(
      'atlas:session-checkout',
      JSON.stringify({ 'ses-1': { checkoutId: 'co-gone' } }),
    )
    changes.answer = {
      checkouts: [
        checkout({ checkoutId: 'co-1', files: [file()] }),
        checkout({ checkoutId: 'co-2', worktreePath: '/work/wt', files: [file()] }),
      ],
    }
    const container = await mount()
    const sections = container.querySelectorAll('[data-changes-checkout]')
    expect(sections[0]?.getAttribute('data-changes-checkout')).toBe('co-1')
  })

  it('shows the spinner, then the diff, of a remembered expanded file', async () => {
    changes.answer = { checkouts: [checkout({ files: [file()] })] }
    window.localStorage.setItem(
      'atlas:session-changes',
      JSON.stringify({ 'ses-1': { expanded: ['co-1:src/app.ts'] } }),
    )
    const text = (await mount()).textContent ?? ''
    expect(contentCalls.length).toBeGreaterThan(0)
    expect(text).toContain('unchanged lines')
  })

  it('selects and expands the checkout that holds a requested change', async () => {
    changes.answer = {
      checkouts: [
        checkout({ checkoutId: 'co-1', files: [file()] }),
        checkout({
          checkoutId: 'co-2',
          worktreePath: '/work/wt',
          files: [file({ path: 'src/b.ts' })],
        }),
      ],
    }
    const container = await mount({
      ...paneValueFixture(),
      openRequest: { kind: EPaneOpen.Changes, path: '/work/wt/src/b.ts', id: 1 },
    })
    const section = container.querySelector('[data-changes-checkout]')
    expect(section?.getAttribute('data-changes-checkout')).toBe('co-2')
    const row = container.querySelector('[data-changed-path="src/b.ts"]')
    expect(row?.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('[data-diff-body="src/b.ts"]')).not.toBeNull()
  })

  it('falls through to the file view when no checkout has the change', async () => {
    changes.answer = { checkouts: [checkout({ files: [file()] })] }
    const requests: { kind: EPaneOpen; path: string }[] = []
    await mount({
      ...paneValueFixture(),
      openRequest: { kind: EPaneOpen.Changes, path: '/work/app/README.md', id: 2 },
      requestOpen: (request) => requests.push(request),
    })
    expect(requests).toEqual([{ kind: EPaneOpen.File, path: '/work/app/README.md' }])
  })

  it('sends a context path with no diff to the context view', async () => {
    changes.answer = { checkouts: [checkout({ files: [file()] })] }
    const requests: { kind: EPaneOpen; path: string }[] = []
    await mount({
      ...paneValueFixture(),
      openRequest: { kind: EPaneOpen.Changes, path: '$ATLAS_CONTEXT_DIR/plan.md', id: 3 },
      requestOpen: (request) => requests.push(request),
    })
    expect(requests).toEqual([{ kind: EPaneOpen.Context, path: '$ATLAS_CONTEXT_DIR/plan.md' }])
  })
})
