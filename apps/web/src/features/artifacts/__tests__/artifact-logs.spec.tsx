import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'
import type { Root } from 'react-dom/client'

import type { ArtifactVersionSummary } from '@dltech/atlas-wire'

import { ArtifactLogs } from '../artifact-logs'
import { versionSummary } from './fixtures'

const VERSIONS = [
  versionSummary({
    version: 3,
    status: 'building',
    createdAt: '2026-11-10T09:00:00.000Z',
    bytes: 0,
    fileCount: 0,
  }),
  versionSummary({
    version: 2,
    status: 'failed',
    createdAt: '2026-11-09T09:00:00.000Z',
    failure: 'build exited 1: vite: Could not resolve "./missing.css"',
  }),
  versionSummary({ version: 1, status: 'ready', createdAt: '2026-11-08T09:00:00.000Z' }),
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

async function mount(versions: readonly ArtifactVersionSummary[]) {
  const { createRoot } = await import('react-dom/client')
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root?.render(<ArtifactLogs versions={versions} />))
}

const rows = () => [...document.querySelectorAll('ul > li')]

describe('ArtifactLogs', () => {
  it('renders every version newest first, failed and building included', async () => {
    await mount(VERSIONS)

    expect(rows()).toHaveLength(3)
    const text = document.body.textContent ?? ''
    expect(rows()[0]?.textContent).toContain('v3')
    expect(rows()[1]?.textContent).toContain('v2')
    expect(text).toContain('Building')
    expect(text).toContain('Failed')
    expect(text).toContain('Live')
  })

  it('shows the failure line of a failed version in a monospace block', async () => {
    await mount(VERSIONS)

    const blocks = [...document.querySelectorAll('pre')]
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.textContent).toContain('Could not resolve "./missing.css"')
    expect(blocks[0]?.className).toContain('font-mono')
    expect(blocks[0]?.className).toContain('text-destructive')
  })

  it('shows the stored log of a version under its failure in a monospace block', async () => {
    await mount([
      versionSummary({
        version: 2,
        status: 'failed',
        failure: 'build exited 1: vite: Could not resolve "./missing.css"',
        durationMs: 4200,
        log: '==> install (exit 0)\n==> build (exit 1)\nCould not resolve "./missing.css"',
      }),
    ])

    const blocks = [...document.querySelectorAll('pre')]
    expect(blocks).toHaveLength(2)
    expect(blocks[0]?.textContent).toContain('Could not resolve')
    expect(blocks[1]?.textContent).toContain('==> build (exit 1)')
    expect(blocks[1]?.className).toContain('font-mono')
    expect(blocks[1]?.className).not.toContain('text-destructive')
  })

  it('collapses a log longer than forty lines and keeps a short one open', async () => {
    const long = Array.from({ length: 60 }, (_, index) => `line ${index + 1}`).join('\n')
    const short = 'bun run build\nbuilt in 1.2s'
    await mount([
      versionSummary({ version: 2, status: 'ready', log: long }),
      versionSummary({ version: 1, status: 'ready', log: short }),
    ])

    const details = [...document.querySelectorAll('details')]
    expect(details).toHaveLength(1)
    expect(details[0]?.hasAttribute('open')).toBe(false)
    expect(details[0]?.querySelector('summary')?.textContent).toContain('60 lines')
    expect(details[0]?.querySelector('pre')?.textContent).toBe(long)
    expect([...document.querySelectorAll('pre')].map((block) => block.textContent)).toContain(short)
  })

  it('has nothing to show before the first build', async () => {
    await mount([])
    expect(document.body.textContent).toContain('no builds yet')
  })
})
