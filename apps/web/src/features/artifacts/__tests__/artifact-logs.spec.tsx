import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'
import type { Root } from 'react-dom/client'

import type { ArtifactBuild } from '@dltech/atlas-wire/web'

import { ArtifactBuildLog } from '../artifact-logs'
import { buildSummary } from './fixtures'

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

async function mount(build: ArtifactBuild) {
  const { createRoot } = await import('react-dom/client')
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root?.render(<ArtifactBuildLog build={build} />))
}

describe('ArtifactBuildLog', () => {
  it('shows the last build status, age and duration', async () => {
    await mount(buildSummary({ durationMs: 4200 }))

    const text = document.body.textContent ?? ''
    expect(text).toContain('Last build')
    expect(text).toContain('Live')
    expect(text).toContain('took 4.2s')
  })

  it('shows the failure line in a monospace block above the log', async () => {
    await mount(
      buildSummary({
        status: 'failed',
        failure: 'build failed with exit code 1: Could not resolve "./missing.css"',
        log: '==> build (exit 1)\nCould not resolve "./missing.css"',
      }),
    )

    const blocks = [...document.querySelectorAll('pre')]
    expect(blocks).toHaveLength(2)
    expect(blocks[0]?.textContent).toContain('Could not resolve')
    expect(blocks[0]?.className).toContain('text-destructive')
    expect(blocks[1]?.textContent).toContain('==> build (exit 1)')
    expect(blocks[1]?.className).toContain('font-mono')
    expect(blocks[1]?.className).not.toContain('text-destructive')
  })

  it('collapses a log longer than forty lines and keeps a short one open', async () => {
    const long = Array.from({ length: 60 }, (_, index) => `line ${index + 1}`).join('\n')

    await mount(buildSummary({ log: long }))

    const details = [...document.querySelectorAll('details')]
    expect(details).toHaveLength(1)
    expect(details[0]?.hasAttribute('open')).toBe(false)
    expect(details[0]?.querySelector('summary')?.textContent).toContain('60 lines')

    await act(async () => root?.unmount())
    container?.remove()
    await mount(buildSummary({ log: 'bun run build\nbuilt in 1.2s' }))

    expect(document.querySelectorAll('details')).toHaveLength(0)
    expect(document.body.textContent).toContain('built in 1.2s')
  })

  it('shows nothing but the timing when nothing was logged', async () => {
    await mount(buildSummary({ durationMs: null }))

    expect(document.querySelectorAll('pre')).toHaveLength(0)
    expect(document.body.textContent).toContain('took —')
  })
})
