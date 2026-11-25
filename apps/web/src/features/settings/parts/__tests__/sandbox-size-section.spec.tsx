import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { act } from 'react'
import type { Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  SandboxSizeSection,
  savedSizeValueOf,
  sizeKeyOf,
  sizeValueToSave,
} from '../sandbox-size-section'

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

const sizeOption = (text: string): Element | undefined =>
  [...document.querySelectorAll('[role="option"]')].find((option) =>
    option.textContent?.includes(text),
  )

const pick = async (text: string): Promise<void> => {
  await act(async () => {
    const option = sizeOption(text)
    option?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    option?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

describe('savedSizeValueOf', () => {
  it('shows the shape a stored size really boots', () => {
    expect(savedSizeValueOf({ value: { vcpus: 2, memoryGb: 4 }, withAccountDefault: false })).toBe(
      '2x4',
    )
    expect(savedSizeValueOf({ value: { vcpus: 4, memoryGb: 16 }, withAccountDefault: false })).toBe(
      '4x16',
    )
    expect(savedSizeValueOf({ value: { vcpus: 8, memoryGb: 64 }, withAccountDefault: false })).toBe(
      '8x64',
    )
  })

  it('maps a stored size with no matching shape to the shape it boots', () => {
    expect(
      savedSizeValueOf({ value: { vcpus: 6, memoryGb: null }, withAccountDefault: false }),
    ).toBe('8x64')
    expect(
      savedSizeValueOf({ value: { vcpus: 32, memoryGb: null }, withAccountDefault: false }),
    ).toBe('8x64')
    expect(
      savedSizeValueOf({ value: { vcpus: 1, memoryGb: null }, withAccountDefault: false }),
    ).toBe('2x4')
  })

  it('shows the account default when the project has no size of its own', () => {
    expect(savedSizeValueOf({ value: null, withAccountDefault: true })).toBe('default')
    expect(savedSizeValueOf({ value: null, withAccountDefault: false })).toBe('2x4')
  })
})

describe('sizeKeyOf', () => {
  it('keys a shape by its vcpus and memory', () => {
    expect(sizeKeyOf({ vcpus: 4, memoryGb: 32 })).toBe('4x32')
  })
})

describe('SandboxSizeSection', () => {
  const html = renderToStaticMarkup(
    <SandboxSizeSection value={{ vcpus: 4, memoryGb: 16 }} onSave={noop} />,
  )

  it('describes the machine a sandbox boots on without a per-vCPU memory claim', () => {
    expect(html).toContain('The machine a new cloud sandbox boots on.')
    expect(html).toContain('resize a running one from its session')
    expect(html).not.toContain('2 GB RAM each')
  })

  it('names no Vercel plan cap', () => {
    expect(html).not.toContain('Enterprise')
    expect(html).not.toContain('Hobby')
    expect(html).not.toContain('Pro up to')
  })

  it('shows the shape the stored size boots', () => {
    const oversized = renderToStaticMarkup(
      <SandboxSizeSection value={{ vcpus: 32, memoryGb: null }} onSave={noop} />,
    )
    expect(oversized).toContain('8 vCPU')
    expect(html).toContain('4 vCPU')
  })

  it('offers Default only where the setting inherits one', () => {
    const withDefault = renderToStaticMarkup(
      <SandboxSizeSection value={null} withAccountDefault onSave={noop} />,
    )
    expect(withDefault).toContain('Default')
    expect(withDefault).not.toContain('Account default')
    expect(html).not.toContain('Default')
  })

  it('shows the resolved shape of the personal default under Default', () => {
    const inherited = renderToStaticMarkup(
      <SandboxSizeSection
        value={null}
        inherited={{ vcpus: 4, memoryGb: 16 }}
        withAccountDefault
        onSave={noop}
      />,
    )
    expect(inherited).toContain('4 vCPU · 16 GB RAM')
    expect(inherited).toContain('text-muted-foreground')
  })

  it('shows the built-in default shape when there is no personal size', () => {
    const fallback = renderToStaticMarkup(
      <SandboxSizeSection value={null} withAccountDefault onSave={noop} />,
    )
    expect(fallback).toContain('2 vCPU · 4 GB RAM')
  })
})

describe('sizeValueToSave', () => {
  it('saves Default as null so the project keeps inheriting', () => {
    expect(sizeValueToSave({ selected: 'default', withAccountDefault: true })).toBeNull()
  })

  it('saves the picked shape as its vcpus and memory', () => {
    expect(sizeValueToSave({ selected: '4x16', withAccountDefault: true })).toEqual({
      vcpus: 4,
      memoryGb: 16,
    })
  })
})

describe('SandboxSizeSection save', () => {
  it('saves 4 vCPU with 16 GB when that shape is picked', async () => {
    const onSave = mock(async () => undefined)
    const view = await renderSection(
      <SandboxSizeSection
        value={{ vcpus: 2, memoryGb: 4 }}
        inherited={{ vcpus: 2, memoryGb: 4 }}
        withAccountDefault
        onSave={onSave}
      />,
    )
    await click(view.querySelector('[aria-label="Sandbox size"]'))
    await pick('16 GB RAM')
    const save = [...view.querySelectorAll('button')].find(
      (button) => button.textContent === 'Save',
    )
    await click(save)
    expect(onSave).toHaveBeenCalledWith({ vcpus: 4, memoryGb: 16 })
  })

  it('saves null after Default is picked', async () => {
    const onSave = mock(async () => undefined)
    const view = await renderSection(
      <SandboxSizeSection
        value={{ vcpus: 4, memoryGb: 16 }}
        inherited={{ vcpus: 8, memoryGb: 64 }}
        withAccountDefault
        onSave={onSave}
      />,
    )
    await click(view.querySelector('[aria-label="Sandbox size"]'))
    await pick('Default')
    const save = [...view.querySelectorAll('button')].find(
      (button) => button.textContent === 'Save',
    )
    await click(save)
    expect(onSave).toHaveBeenCalledWith(null)
  })
})
