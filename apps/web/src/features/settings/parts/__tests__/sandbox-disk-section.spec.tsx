import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { act } from 'react'
import type { Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  SANDBOX_DISK_OPTIONS,
  SandboxDiskSection,
  defaultDiskGbOf,
  diskValueToSave,
  savedDiskValueOf,
} from '../sandbox-disk-section'

const noop = async () => undefined

let root: Root | null = null
let container: HTMLDivElement | null = null

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await unregisterDom()
})

afterEach(async () => {
  const mounted = root
  if (mounted !== null) await act(async () => mounted.unmount())
  root = null
  container?.remove()
  container = null
  document.body.innerHTML = ''
})

const click = async (element: Element | null | undefined): Promise<void> => {
  await act(async () => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

const renderSection = async (node: React.ReactElement): Promise<HTMLDivElement> => {
  const { createRoot } = await import('react-dom/client')
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const mounted = root
  await act(async () => mounted.render(node))
  return container
}

const diskOption = (label: string): Element | undefined =>
  [...document.querySelectorAll('[role="option"]')].find((option) =>
    option.textContent?.startsWith(label),
  )

describe('savedDiskValueOf', () => {
  it('shows the disk a stored size asks for', () => {
    expect(savedDiskValueOf({ diskGb: 20, withAccountDefault: false })).toBe('20')
    expect(savedDiskValueOf({ diskGb: 100, withAccountDefault: false })).toBe('100')
  })

  it('shows the shipped default when nothing is stored', () => {
    expect(savedDiskValueOf({ diskGb: null, withAccountDefault: false })).toBe('20')
  })

  it('shows the inherited default when the project has no disk of its own', () => {
    expect(savedDiskValueOf({ diskGb: null, withAccountDefault: true })).toBe('default')
  })

  it('offers only the sizes Agent37 can boot', () => {
    expect(SANDBOX_DISK_OPTIONS.map((option) => option.value)).toEqual([
      '20',
      '30',
      '40',
      '60',
      '80',
      '100',
    ])
  })
})

describe('defaultDiskGbOf', () => {
  it('resolves the personal disk setting when the user has one', () => {
    expect(defaultDiskGbOf(60)).toBe(60)
  })

  it('falls back to the shipped default when the user has none', () => {
    expect(defaultDiskGbOf(undefined)).toBe(20)
  })
})

describe('diskValueToSave', () => {
  it('stores null when the project keeps the default', () => {
    expect(diskValueToSave({ selected: 'default', withAccountDefault: true })).toBeNull()
  })

  it('stores the picked size otherwise', () => {
    expect(diskValueToSave({ selected: '40', withAccountDefault: true })).toBe(40)
    expect(diskValueToSave({ selected: '40', withAccountDefault: false })).toBe(40)
  })
})

describe('SandboxDiskSection', () => {
  const html = renderToStaticMarkup(<SandboxDiskSection value={40} onSave={noop} />)

  it('states the intended behaviour in the copy', () => {
    expect(html).toContain('Disk size for new pods.')
    expect(html).toContain('Pods grow automatically when they fill up.')
  })

  it('says the setting is Agent37 only', () => {
    expect(html).toContain('Agent37 pods only.')
  })

  it('shows the stored size', () => {
    expect(html).toContain('40 GB')
  })

  it('offers a default only where the setting inherits one', () => {
    const withDefault = renderToStaticMarkup(
      <SandboxDiskSection value={null} withAccountDefault onSave={noop} />,
    )
    expect(withDefault).toContain('Default')
    expect(html).not.toContain('Default')
  })

  it('shows the personal disk dimmed under the default', () => {
    const inheriting = renderToStaticMarkup(
      <SandboxDiskSection value={null} inheritedDiskGb={60} withAccountDefault onSave={noop} />,
    )
    expect(inheriting).toContain('Default')
    expect(inheriting).toContain('60 GB')
    expect(inheriting).toContain('text-muted-foreground')
  })

  it('shows the shipped disk dimmed when the user has no personal one', () => {
    const inheriting = renderToStaticMarkup(
      <SandboxDiskSection value={null} withAccountDefault onSave={noop} />,
    )
    expect(inheriting).toContain('Default')
    expect(inheriting).toContain('20 GB')
    expect(inheriting).toContain('text-muted-foreground')
  })
})

describe('SandboxDiskSection save', () => {
  it('saves null after Default is picked', async () => {
    const onSave = mock(async () => undefined)
    const view = await renderSection(
      <SandboxDiskSection value={40} inheritedDiskGb={60} withAccountDefault onSave={onSave} />,
    )
    await click(view.querySelector('[aria-label="Sandbox disk"]'))
    await act(async () => {
      const option = diskOption('Default')
      option?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      option?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    const save = [...view.querySelectorAll('button')].find(
      (button) => button.textContent === 'Save',
    )
    await click(save)
    expect(onSave).toHaveBeenCalledWith(null)
  })
})
