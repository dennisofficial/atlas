import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { act } from 'react'
import type { Root } from 'react-dom/client'

import { ArtifactHeader } from '../artifact-header'
import { artifactSummary } from './fixtures'

const ARTIFACT = artifactSummary({ name: 'Docs', currentVersion: 2 })

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

const buttons = () => [...document.querySelectorAll('button')]

const button = (label: string) => buttons().find((element) => element.textContent?.trim() === label)

const click = (element: Element | undefined) =>
  act(async () => {
    element?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  })

async function mount(args: { rollbackTarget: number | null; onUnpublish: () => void }) {
  const { createRoot } = await import('react-dom/client')
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () =>
    root?.render(
      <ArtifactHeader
        artifact={ARTIFACT}
        rollbackTarget={args.rollbackTarget}
        busy={false}
        onRollback={() => undefined}
        onUnpublish={args.onUnpublish}
      />,
    ),
  )
}

describe('ArtifactHeader', () => {
  it('offers Open, Copy URL, Rollback and Unpublish', async () => {
    await mount({ rollbackTarget: 1, onUnpublish: () => undefined })

    const text = document.body.textContent ?? ''
    expect(buttons().map((element) => element.textContent?.trim())).toEqual([
      'Copy URL',
      'Rollback to v1',
      'Unpublish',
    ])
    const open = document.querySelector('a[href="https://abc123-demo.artifacts.example"]')
    expect(open?.textContent).toContain('Open')
    expect(open?.getAttribute('target')).toBe('_blank')
    expect(text).toContain('https://abc123-demo.artifacts.example')
  })

  it('cannot roll back when no other version is ready', async () => {
    await mount({ rollbackTarget: null, onUnpublish: () => undefined })

    expect(button('Rollback')?.hasAttribute('disabled')).toBe(true)
  })

  it('asks for confirmation before it unpublishes', async () => {
    const onUnpublish = mock(() => undefined)
    await mount({ rollbackTarget: null, onUnpublish })

    await click(button('Unpublish'))

    const dialog = document.querySelector('[role="alertdialog"], [role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog?.textContent).toContain('Unpublish Docs?')
    expect(onUnpublish).not.toHaveBeenCalled()

    const confirm = [...(dialog?.querySelectorAll('button') ?? [])].find(
      (element) => element.textContent?.trim() === 'Unpublish',
    )
    await click(confirm)
    expect(onUnpublish).toHaveBeenCalledTimes(1)
  })
})
