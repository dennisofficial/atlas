import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { act } from 'react'
import type { Root } from 'react-dom/client'

import { ArtifactHeader } from '../artifact-header'
import { artifactSummary } from './fixtures'

const ARTIFACT = artifactSummary({ name: 'Docs' })

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

async function mount(args: { busy?: boolean; onDelete: () => void }) {
  const { createRoot } = await import('react-dom/client')
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () =>
    root?.render(
      <ArtifactHeader artifact={ARTIFACT} busy={args.busy ?? false} onDelete={args.onDelete} />,
    ),
  )
}

describe('ArtifactHeader', () => {
  it('offers Open, Copy URL and Delete, and no rollback', async () => {
    await mount({ onDelete: () => undefined })

    expect(buttons().map((element) => element.textContent?.trim())).toEqual(['Copy URL', 'Delete'])
    const open = document.querySelector('a[href="https://ab12cd34ef56.artifacts.example"]')
    expect(open?.textContent).toContain('Open')
    expect(open?.getAttribute('target')).toBe('_blank')
    expect(document.body.textContent).toContain('https://ab12cd34ef56.artifacts.example')
  })

  it('asks for confirmation before it unpublishes', async () => {
    const onDelete = mock(() => undefined)
    await mount({ onDelete })

    await click(button('Delete'))

    const dialog = document.querySelector('[role="alertdialog"], [role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog?.textContent).toContain('Delete Docs?')
    expect(onDelete).not.toHaveBeenCalled()

    const confirm = [...(dialog?.querySelectorAll('button') ?? [])].find(
      (element) => element.textContent?.trim() === 'Delete',
    )
    await click(confirm)
    expect(onDelete).toHaveBeenCalledTimes(1)
  })
})
