import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'
import type { Root } from 'react-dom/client'

import { ArtifactFiles } from '../artifact-files'
import { artifactSummary, manifestEntry } from './fixtures'

const ARTIFACT = artifactSummary({ url: 'https://abc123-demo.artifacts.example' })

const MANIFEST = [
  manifestEntry({ path: 'index.html', size: 2048 }),
  manifestEntry({ path: 'assets/app.css', type: 'text/css' }),
  manifestEntry({ path: 'assets/img/logo.svg', type: 'image/svg+xml' }),
  manifestEntry({ path: 'src/app/page.tsx', tree: 'src', type: 'text/typescript' }),
]

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

async function mount() {
  const { createRoot } = await import('react-dom/client')
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root?.render(<ArtifactFiles artifact={ARTIFACT} manifest={MANIFEST} />))
}

const button = (label: string) =>
  [...document.querySelectorAll('button')].find((element) => element.textContent?.trim() === label)

const click = (label: string) =>
  act(async () => {
    button(label)?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  })

const hrefs = () =>
  [...document.querySelectorAll('a')].map((anchor) => anchor.getAttribute('href') ?? '')

describe('ArtifactFiles', () => {
  it('builds the dist tree from the manifest with nested directories', async () => {
    await mount()

    expect(hrefs()).toEqual([
      'https://abc123-demo.artifacts.example/assets/img/logo.svg',
      'https://abc123-demo.artifacts.example/assets/app.css',
      'https://abc123-demo.artifacts.example/index.html',
    ])
    const text = document.body.textContent ?? ''
    expect(text).toContain('assets')
    expect(text).toContain('img')
    expect(text).toContain('text/css')
    expect(text).toContain('2.0 KB')
    expect(document.body.textContent).not.toContain('page.tsx')
  })

  it('opens a file in a new tab through the artifact URL', async () => {
    await mount()

    const [first] = [...document.querySelectorAll('a')]
    expect(first?.getAttribute('target')).toBe('_blank')
    expect(first?.getAttribute('rel')).toBe('noreferrer')
  })

  it('switches to the src tree and back', async () => {
    await mount()

    await click('src')
    expect(hrefs()).toEqual(['https://abc123-demo.artifacts.example/src/app/page.tsx'])
    expect(button('src')?.getAttribute('aria-pressed')).toBe('true')

    await click('dist')
    expect(hrefs()).toHaveLength(3)
  })

  it('says when the selected tree is empty', async () => {
    const { createRoot } = await import('react-dom/client')
    const empty = document.createElement('div')
    document.body.append(empty)
    root = createRoot(empty)
    await act(async () => root?.render(<ArtifactFiles artifact={ARTIFACT} manifest={[]} />))

    expect(document.body.textContent).toContain('This version has no dist files.')
  })
})
