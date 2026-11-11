import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { act } from 'react'
import type { Root } from 'react-dom/client'

import { ArtifactHistory, ArtifactMetadata } from '../artifact-history'
import { artifactSummary, versionSummary } from './fixtures'

const ARTIFACT = artifactSummary({
  slug: 'demo',
  currentVersion: 2,
  bytes: 2048,
  fileCount: 3,
})

const VERSIONS = [
  versionSummary({ version: 3, status: 'building', createdAt: '2026-11-10T09:00:00.000Z' }),
  versionSummary({ version: 2, createdAt: '2026-11-09T09:00:00.000Z' }),
  versionSummary({ version: 1, createdAt: '2026-11-08T09:00:00.000Z' }),
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

async function mount(onRollback = mock((_version: number) => undefined)) {
  const { createRoot } = await import('react-dom/client')
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () =>
    root?.render(
      <ArtifactHistory
        artifact={ARTIFACT}
        versions={VERSIONS}
        busy={false}
        onRollback={onRollback}
      />,
    ),
  )
  return onRollback
}

const rollbackButton = (version: number) =>
  [...document.querySelectorAll('button')].find(
    (element) => element.textContent?.trim() === `Rollback to v${version}`,
  )

describe('ArtifactHistory', () => {
  it('lists versions newest first', async () => {
    await mount()

    const versions = [...document.querySelectorAll('ul > li')].map(
      (row) => row.querySelector('span')?.textContent ?? '',
    )
    expect(versions).toEqual(['v3', 'v2', 'v1'])
  })

  it('disables rollback on the current version and on a version that is not ready', async () => {
    await mount()

    expect(rollbackButton(2)?.hasAttribute('disabled')).toBe(true)
    expect(rollbackButton(3)?.hasAttribute('disabled')).toBe(true)
    expect(rollbackButton(1)?.hasAttribute('disabled')).toBe(false)
  })

  it('asks for the version the action names', async () => {
    const onRollback = await mount()

    await act(async () => {
      rollbackButton(1)?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    })

    expect(onRollback).toHaveBeenCalledWith(1)
  })
})

describe('ArtifactMetadata', () => {
  it('shows what the manifest is worth and when it changed', async () => {
    const { createRoot } = await import('react-dom/client')
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(<ArtifactMetadata artifact={ARTIFACT} />))

    const text = document.body.textContent ?? ''
    expect(text).toContain('demo')
    expect(text).toContain('v2')
    expect(text).toContain('2.0 KB')
    expect(text).toContain('Nov 10')
  })

  it('truncates the source and spec hashes and keeps the full value on the title', async () => {
    const { createRoot } = await import('react-dom/client')
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(<ArtifactMetadata artifact={ARTIFACT} />))

    const source = document.querySelector(`[title="${'b'.repeat(64)}"]`)
    const spec = document.querySelector(`[title="${'c'.repeat(64)}"]`)

    expect(source?.textContent).toBe('b'.repeat(12))
    expect(spec?.textContent).toBe('c'.repeat(12))
  })
})
