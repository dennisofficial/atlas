import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock, test } from 'bun:test'
import { act } from 'react'
import * as realNavigation from 'next/navigation'
import * as realSonner from 'sonner'

import { IN_APP_NOTICE_FIXTURES } from '../fixtures/notifications'
import { scanNotices, staleNoticeIdsOf } from '../notice-scan'

type ToastOptions = {
  id?: string
  description?: string
  action?: { label: string; onClick: () => void }
}

type ShownToast = { title: string; options: ToastOptions }

const shown: ShownToast[] = []
const dismissed: string[] = []
const pushed: string[] = []

const realSonnerExports = { ...realSonner }

mock.module('sonner', () => ({
  toast: Object.assign((title: string, options: ToastOptions) => shown.push({ title, options }), {
    dismiss: (id: string) => dismissed.push(id),
  }),
}))

let pathname = '/'

mock.module('next/navigation', () => ({
  ...realNavigation,
  usePathname: () => pathname,
  useRouter: () => ({ push: (href: string) => pushed.push(href) }),
}))

const { InAppNotices } = await import('../in-app-notices')

let root: { render: (node: React.ReactElement) => void; unmount: () => void } | null = null

const mount = async () => {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root?.render(<InAppNotices />))
}

const rerender = async () => {
  await act(async () => root?.render(<InAppNotices />))
}

const focusWindow = async () => {
  await act(async () => {
    window.dispatchEvent(new Event('focus'))
  })
}

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  mock.module('sonner', () => realSonnerExports)
  mock.module('next/navigation', () => realNavigation)
  await GlobalRegistrator.unregister()
})

beforeEach(async () => {
  pathname = '/'
  shown.length = 0
  dismissed.length = 0
  pushed.length = 0
  document.hasFocus = () => true
  if (root !== null) await act(async () => root?.unmount())
  root = null
})

describe('scanNotices', () => {
  test('says nothing while the window is not focused', () => {
    expect(
      scanNotices({
        notices: IN_APP_NOTICE_FIXTURES,
        shown: [],
        focused: false,
        openSessionId: null,
      }),
    ).toEqual([])
  })

  test('returns every notice that is not on screen, once', () => {
    expect(
      scanNotices({
        notices: IN_APP_NOTICE_FIXTURES,
        shown: [],
        focused: true,
        openSessionId: null,
      }),
    ).toHaveLength(IN_APP_NOTICE_FIXTURES.length)
    expect(
      scanNotices({
        notices: IN_APP_NOTICE_FIXTURES,
        shown: IN_APP_NOTICE_FIXTURES.map((notice) => notice.sessionId),
        focused: true,
        openSessionId: null,
      }),
    ).toEqual([])
  })

  test('skips the notice of the session that is on screen', () => {
    const found = scanNotices({
      notices: IN_APP_NOTICE_FIXTURES,
      shown: [],
      focused: true,
      openSessionId: 'thr-ui-rebase',
    })
    expect(found.map((notice) => notice.sessionId)).toEqual(['thr-snapshots'])
  })
})

describe('staleNoticeIdsOf', () => {
  test('names the notice of the session that just opened', () => {
    expect(
      staleNoticeIdsOf({
        shown: ['thr-ui-rebase', 'thr-snapshots'],
        notices: IN_APP_NOTICE_FIXTURES,
        openSessionId: 'thr-ui-rebase',
      }),
    ).toEqual(['thr-ui-rebase'])
  })

  test('says nothing when no notice is open', () => {
    expect(
      staleNoticeIdsOf({
        shown: ['thr-ui-rebase'],
        notices: IN_APP_NOTICE_FIXTURES,
        openSessionId: null,
      }),
    ).toEqual([])
  })
})

describe('InAppNotices', () => {
  it('shows nothing on load while the window is blurred', async () => {
    document.hasFocus = () => false
    await mount()
    expect(shown).toEqual([])
  })

  it('shows the notices when the window gains focus', async () => {
    document.hasFocus = () => false
    await mount()
    document.hasFocus = () => true
    await focusWindow()
    expect(shown).toHaveLength(IN_APP_NOTICE_FIXTURES.length)
    expect(shown[0]?.title).toBe('Fix the sidebar')
    expect(shown[0]?.options.id).toBe('thr-ui-rebase')
    expect(shown[0]?.options.description).toBe('Finished')
    expect(shown[0]?.options.action?.label).toBe('Open')
  })

  it('opens the session behind the notice', async () => {
    await mount()
    shown[0]?.options.action?.onClick()
    expect(pushed).toEqual(['/threads/thr-ui-rebase'])
  })

  it('shows a notice once across focus changes', async () => {
    await mount()
    await focusWindow()
    expect(shown).toHaveLength(IN_APP_NOTICE_FIXTURES.length)
  })

  it('leaves the open session out', async () => {
    pathname = '/threads/thr-ui-rebase'
    await mount()
    expect(shown.map((toast) => toast.options.id)).toEqual(['thr-snapshots'])
  })

  it('dismisses the toast when its session opens', async () => {
    await mount()
    pathname = '/threads/thr-ui-rebase'
    await rerender()
    expect(dismissed).toEqual(['thr-ui-rebase'])
  })
})
