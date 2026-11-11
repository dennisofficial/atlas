import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { act } from 'react'
import type { Root } from 'react-dom/client'

import { fakeFetch, trpcOk } from '@/features/threads/data/__tests__/trpc-fake'

const replace = mock((_href: string) => {})
let query = ''

mock.module('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(query),
}))

mock.module('../routine-create-sheet', () => ({
  RoutineCreateSheet: ({
    open,
    onOpenChange,
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
  }) =>
    open ? (
      <button type="button" onClick={() => onOpenChange(false)}>
        sheet open
      </button>
    ) : null,
}))

let root: Root | null = null

const settle = (): Promise<void> =>
  act(async () => new Promise<void>((done) => setTimeout(done, 20)))

const mount = async (search: string): Promise<HTMLElement> => {
  query = search
  const { createTestQueryClient, TestQueryProvider } = await import(
    '@/lib/__tests__/query-test-provider'
  )
  const { createRoot } = await import('react-dom/client')
  const { RoutinesIndexRoute } = await import('../routines-index-route')
  const host = document.createElement('div')
  root = createRoot(host)
  const client = createTestQueryClient()
  await act(async () =>
    root?.render(
      <TestQueryProvider client={client}>
        <RoutinesIndexRoute />
      </TestQueryProvider>,
    ),
  )
  await settle()
  return host
}

const clickOn = async ({ host, label }: { host: HTMLElement; label: string }): Promise<void> => {
  const button = [...host.querySelectorAll('button')].find((candidate) =>
    (candidate.textContent ?? '').includes(label),
  )
  if (button === undefined) throw new Error(`no button labelled ${label}`)
  await act(async () => button.click())
}

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

afterEach(async () => {
  try {
    const mounted = root
    if (mounted !== null) await act(async () => mounted.unmount())
  } finally {
    root = null
    replace.mockClear()
  }
})

describe('RoutinesIndexRoute create sheet', () => {
  it('opens the sheet the search parameter asks for', async () => {
    fakeFetch(() => trpcOk({ routines: [] }))
    const host = await mount('new=1')
    expect(host.textContent).toContain('sheet open')
  })

  it('keeps the sheet shut without the parameter and lets the empty state open it', async () => {
    fakeFetch(() => trpcOk({ routines: [] }))
    const host = await mount('')
    expect(host.textContent).not.toContain('sheet open')

    await clickOn({ host, label: 'New routine' })
    expect(replace).toHaveBeenCalledWith('/routines?new=1')
  })

  it('clears the parameter when the sheet closes', async () => {
    fakeFetch(() => trpcOk({ routines: [] }))
    const host = await mount('new=1')
    await clickOn({ host, label: 'sheet open' })
    expect(replace).toHaveBeenCalledWith('/routines')
  })
})
