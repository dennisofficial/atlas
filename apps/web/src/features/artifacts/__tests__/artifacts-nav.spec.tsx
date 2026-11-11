import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'
import type { Root } from 'react-dom/client'

import { activeNavOf } from '@/features/shell/active-route'
import { EAppNav } from '@/features/shell/shell-types'

let root: Root | null = null
let container: HTMLDivElement | null = null

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

afterEach(async () => {
  const mounted = root
  if (mounted !== null) await act(async () => mounted.unmount())
  root = null
  container?.remove()
  container = null
})

describe('the artifacts nav item', () => {
  it('marks artifact paths as Artifacts', () => {
    expect(activeNavOf('/artifacts')).toBe(EAppNav.Artifacts)
    expect(activeNavOf('/artifacts/demo')).toBe(EAppNav.Artifacts)
    expect(activeNavOf('/artifactsx')).toBe(EAppNav.Threads)
  })

  it('marks itself active in the bottom nav on /artifacts', async () => {
    const { createRoot } = await import('react-dom/client')
    const { ShellBottomNav } = await import('@/features/shell/shell-bottom-nav')
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(<ShellBottomNav activeNav={EAppNav.Artifacts} />))

    const link = document.querySelector('a[aria-label="Artifacts"]')
    expect(link?.getAttribute('href')).toBe('/artifacts')
    expect(link?.getAttribute('aria-current')).toBe('page')
    expect(
      document.querySelector('a[aria-label="Threads"]')?.getAttribute('aria-current'),
    ).toBeNull()
  })
})
