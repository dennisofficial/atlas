import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import { act, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const { Sheet, SheetContent, SheetTitle } = await import('../sheet')
const { Sidebar, SidebarProvider } = await import('../sidebar')

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

let root: { render: (node: ReactElement) => void; unmount: () => void } | null = null

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

async function mount(element: ReactElement) {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root?.render(element))
}

const classesOf = ({ html, slot }: { html: string; slot: string }): string[] => {
  const host = document.createElement('div')
  host.innerHTML = html
  return [...(host.querySelector(`[data-slot="${slot}"]`)?.classList ?? [])]
}

describe('safe-area insets', () => {
  it('defines the top and side insets once, falling back to zero', async () => {
    const css = await Bun.file(new URL('../../styles/base.css', import.meta.url)).text()
    for (const side of ['top', 'right', 'left']) {
      expect(css).toContain(`--safe-area-${side}: env(safe-area-inset-${side}, 0px);`)
    }
  })

  it('pads the sidebar layout and runs the sidebar surface under the status bar', () => {
    const html = renderToStaticMarkup(
      <SidebarProvider>
        <Sidebar>nav</Sidebar>
      </SidebarProvider>,
    )
    expect(classesOf({ html, slot: 'sidebar-wrapper' })).toEqual(
      expect.arrayContaining([
        'pt-(--safe-area-top)',
        'pr-(--safe-area-right)',
        'pl-(--safe-area-left)',
      ]),
    )
    expect(classesOf({ html, slot: 'sidebar-container' })).toEqual(
      expect.arrayContaining(['inset-y-0', 'data-[side=left]:left-(--safe-area-left)']),
    )
    expect(classesOf({ html, slot: 'sidebar-inner' })).toContain('pt-(--safe-area-top)')
  })

  it('opens a side sheet below the status bar', async () => {
    await mount(
      <Sheet open>
        <SheetContent side="right">
          <SheetTitle>Panel</SheetTitle>
        </SheetContent>
      </Sheet>,
    )
    const sheet = document.body.querySelector('[data-slot="sheet-content"]')
    expect(sheet?.getAttribute('data-side')).toBe('right')
    expect([...(sheet?.classList ?? [])]).toEqual(
      expect.arrayContaining([
        'data-[side=right]:top-(--safe-area-top)',
        'data-[side=right]:right-(--safe-area-right)',
        'data-[side=right]:bottom-0',
      ]),
    )
  })
})
