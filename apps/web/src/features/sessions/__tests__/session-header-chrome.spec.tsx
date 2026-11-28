import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { SidebarProvider } from '@dltech/atlas-ui/components/sidebar'

import { EHeaderState } from '@/features/threads/data/header-model'
import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'

import { ShellMobileBar } from '@/features/shell/shell-mobile-bar'
import { ShellSkeleton } from '@/features/shell/shell-skeletons'
import { SessionHeader } from '../session-header'

beforeAll(() => registerDom())
afterAll(async () => unregisterDom())

function headerOf(state: EHeaderState) {
  const container = document.createElement('div')
  container.innerHTML = renderToStaticMarkup(
    <SidebarProvider>
      <SessionHeader
        sessionId="session-1"
        state={state}
        title="Fix login"
        naming={false}
        branch="dennis/login"
        entries={[
          {
            repo: 'owner/atlas',
            number: 12,
            url: 'https://github.com/owner/atlas/pull/12',
            branch: 'dennis/login',
            state: 'merged',
            checksRunning: 0,
            checksPassed: 2,
            checksFailed: 0,
            mergeable: true,
            current: true,
            via: undefined,
          },
        ]}
        subscriptions={[]}
        shells={{ running: 0, awaitingInput: false, labels: [], rows: [] }}
        shellTails={{}}
        crew={{ running: 0, total: 0 }}
        crewRows={[]}
        previews={[]}
        onOpenPreview={() => undefined}
      />
    </SidebarProvider>,
  )
  return container
}

describe('SessionHeader chrome', () => {
  it('uses spacing instead of a border to separate the card header', () => {
    const header = headerOf(EHeaderState.Idle).querySelector('header')
    expect(header?.classList.contains('h-14')).toBe(true)
    expect(header?.classList.contains('border-b')).toBe(false)
  })

  it('shows branch and pull request metadata as soft, muted pills', () => {
    const container = headerOf(EHeaderState.Idle)
    for (const selector of ['[data-session-branch]', '[data-session-pr]']) {
      const pill = container.querySelector(selector)
      expect(pill?.classList.contains('h-5')).toBe(true)
      expect(pill?.classList.contains('bg-secondary')).toBe(true)
      expect(pill?.classList.contains('text-muted-foreground')).toBe(true)
      expect(pill?.classList.contains('border-border')).toBe(false)
    }
    expect(container.querySelector('[data-session-pr] a')?.getAttribute('href')).toBe(
      'https://github.com/owner/atlas/pull/12',
    )
  })

  for (const state of [EHeaderState.Idle, EHeaderState.Running]) {
    it(`keeps the ${state} status quiet`, () => {
      const badges = headerOf(state).querySelectorAll('[data-slot="badge"]')
      const status = badges[badges.length - 1]
      expect(status?.getAttribute('data-variant')).toBe('secondary')
      expect(status?.classList.contains('bg-secondary')).toBe(true)
      expect(status?.classList.contains('text-muted-foreground')).toBe(true)
    })
  }

  it('preserves emphasis for failure and operator attention states', () => {
    for (const [state, variant] of [
      [EHeaderState.Failed, 'destructive'],
      [EHeaderState.NeedsYou, 'default'],
    ] as const) {
      const badges = headerOf(state).querySelectorAll('[data-slot="badge"]')
      const status = badges[badges.length - 1]
      expect(status?.getAttribute('data-variant')).toBe(variant)
      expect(status?.classList.contains('text-muted-foreground')).toBe(false)
    }
  })

  it('keeps the mobile shell and its loading bar borderless too', () => {
    const container = document.createElement('div')
    container.innerHTML = renderToStaticMarkup(
      <SidebarProvider>
        <ShellMobileBar />
      </SidebarProvider>,
    )
    expect(container.querySelector('header')?.classList.contains('border-b')).toBe(false)
    const skeleton = renderToStaticMarkup(<ShellSkeleton />)
    expect(skeleton).not.toContain('gap-2 border-b px-2 md:hidden')
  })
})
