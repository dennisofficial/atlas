import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { EChangeFileStatus, type SessionChangesOutput } from '@dltech/atlas-protocol'
import { act } from 'react'
import type { Root } from 'react-dom/client'

import { paneValueFixture } from '../../panel/__tests__/fixture'
import { SessionPaneProvider } from '../../panel/pane-value'

const changes = { answer: undefined as SessionChangesOutput | Error | undefined }

mock.module('@/features/sessions/changes/changes-api', () => ({
  fetchChanges: async () => {
    const answer = changes.answer
    if (answer instanceof Error) throw answer
    return answer ?? { checkouts: [] }
  },
  fetchChangeContent: async () => ({
    url: 'https://signed.test/current',
    hash: 'current',
    size: 4,
    validUntil: 0,
  }),
}))

const { CheckoutChoiceProvider, useCheckoutChoice } = await import('../checkout-choice-context')
const { CheckoutSelect } = await import('../checkout-select')

const checkout = (overrides: Partial<SessionChangesOutput['checkouts'][number]> = {}) => ({
  checkoutId: overrides.checkoutId ?? 'co-1',
  repo: 'owner/atlas',
  worktreePath: `/work/${overrides.checkoutId ?? 'co-1'}`,
  base: 'main',
  updatedAt: 1,
  files: [
    {
      path: 'src/app.ts',
      oldPath: null,
      status: EChangeFileStatus.Modified,
      additions: 1,
      deletions: 1,
      binary: false,
      size: 8,
      baseHash: 'base',
      currentHash: 'current',
    },
  ],
  ...overrides,
})

const roots = new Set<Root>()

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await unregisterDom()
})

beforeEach(() => {
  changes.answer = undefined
})

afterEach(async () => {
  for (const root of roots) await act(async () => root.unmount())
  roots.clear()
  window.localStorage.clear()
})

const settle = async (): Promise<void> => {
  for (let round = 0; round < 4; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
  }
}

function Probe() {
  const { selectedId, select } = useCheckoutChoice()
  return (
    <div>
      <span data-probe-selected>{selectedId ?? 'none'}</span>
      <CheckoutSelect />
      <button type="button" data-probe-pick onClick={() => select('co-2')}>
        pick second
      </button>
    </div>
  )
}

async function mount(currentWorktreePath?: string): Promise<HTMLDivElement> {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  const root = createRoot(container)
  roots.add(root)
  await act(async () =>
    root.render(
      <SessionPaneProvider value={paneValueFixture()}>
        <CheckoutChoiceProvider
          sessionId="ses-1"
          status={undefined}
          currentWorktreePath={currentWorktreePath}
        >
          <Probe />
        </CheckoutChoiceProvider>
      </SessionPaneProvider>,
    ),
  )
  await settle()
  return container
}

const selectedOf = (container: HTMLDivElement): string | null | undefined =>
  container.querySelector('[data-probe-selected]')?.textContent

describe('CheckoutChoice', () => {
  it('shows one select for two checkouts', async () => {
    changes.answer = {
      checkouts: [checkout({ checkoutId: 'co-1' }), checkout({ checkoutId: 'co-2' })],
    }
    const container = await mount()
    expect(container.querySelectorAll('[data-checkout-select]')).toHaveLength(1)
  })

  it('shows no select for a single checkout', async () => {
    changes.answer = { checkouts: [checkout({ checkoutId: 'co-1' })] }
    const container = await mount()
    expect(container.querySelectorAll('[data-checkout-select]')).toHaveLength(0)
  })

  it('remembers the chosen checkout for the session', async () => {
    changes.answer = {
      checkouts: [checkout({ checkoutId: 'co-1' }), checkout({ checkoutId: 'co-2' })],
    }
    const container = await mount()
    expect(selectedOf(container)).toBe('co-1')
    const pick = container.querySelector('[data-probe-pick]')
    if (!(pick instanceof HTMLElement)) throw new Error('probe button missing')
    await act(async () => pick.click())
    expect(selectedOf(container)).toBe('co-2')
    expect(JSON.parse(window.localStorage.getItem('atlas:session-checkout') ?? '{}')).toEqual({
      'ses-1': { checkoutId: 'co-2' },
    })
  })

  it('starts on the active thread worktree, not the primary one', async () => {
    changes.answer = {
      checkouts: [
        checkout({ checkoutId: 'co-1', worktreePath: '/work/atlas' }),
        checkout({ checkoutId: 'co-2', worktreePath: '/work/atlas-sub' }),
      ],
    }
    const container = await mount('/work/atlas-sub')
    expect(selectedOf(container)).toBe('co-2')
  })

  it('falls back to the first checkout when the remembered one is gone', async () => {
    window.localStorage.setItem(
      'atlas:session-checkout',
      JSON.stringify({ 'ses-1': { checkoutId: 'co-gone' } }),
    )
    changes.answer = {
      checkouts: [checkout({ checkoutId: 'co-1' }), checkout({ checkoutId: 'co-2' })],
    }
    const container = await mount()
    expect(selectedOf(container)).toBe('co-1')
  })

  it('keeps a remembered checkout that is still offered', async () => {
    window.localStorage.setItem(
      'atlas:session-checkout',
      JSON.stringify({ 'ses-1': { checkoutId: 'co-2' } }),
    )
    changes.answer = {
      checkouts: [checkout({ checkoutId: 'co-1' }), checkout({ checkoutId: 'co-2' })],
    }
    const container = await mount()
    expect(selectedOf(container)).toBe('co-2')
  })
})
