import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { act } from 'react'
import type { Root } from 'react-dom/client'

import type { ArtifactSummary } from '@dltech/atlas-wire/web'

import { createTestQueryClient, TestQueryProvider } from '@/lib/__tests__/query-test-provider'

import { artifactSummary, buildSummary } from './fixtures'

const state: { artifacts: ArtifactSummary[] } = { artifacts: [] }

mock.module('next/navigation', () => ({ useRouter: () => ({ push: () => undefined }) }))

mock.module('../artifacts-api', () => ({
  ARTIFACTS_KEY: 'artifacts',
  artifactKeyOf: (slug: string) => `artifact:${slug}`,
  fetchArtifacts: async () => ({ artifacts: state.artifacts }),
  fetchArtifact: async () => ({
    artifact: artifactSummary(),
    build: buildSummary(),
  }),
  deleteArtifact: async () => ({ ok: true }),
}))

const { ArtifactsView } = await import('../artifacts-view')

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

const settle = (ms = 40) =>
  act(async () => void (await new Promise((done) => setTimeout(done, ms))))

async function mount() {
  const { createRoot } = await import('react-dom/client')
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () =>
    root?.render(
      <TestQueryProvider client={createTestQueryClient()}>
        <ArtifactsView />
      </TestQueryProvider>,
    ),
  )
  await settle()
}

const rowNames = () =>
  [...document.querySelectorAll('ul > li')].map(
    (row) => row.querySelector('span.truncate')?.textContent ?? '',
  )

describe('ArtifactsView', () => {
  it('renders a row per artifact, newest updated first', async () => {
    state.artifacts = [
      artifactSummary({
        subdomain: 'ab12cd34ef56',
        name: 'Old',
        updatedAt: '2026-11-01T00:00:00.000Z',
      }),
      artifactSummary({
        subdomain: 'zy98wx76vu54',
        name: 'New',
        updatedAt: '2026-11-10T00:00:00.000Z',
      }),
    ]
    await mount()

    const links = [...document.querySelectorAll('a')].filter((anchor) =>
      anchor.getAttribute('href')?.startsWith('/artifacts/'),
    )
    expect(links.map((anchor) => anchor.getAttribute('href'))).toEqual([
      '/artifacts/zy98wx76vu54',
      '/artifacts/ab12cd34ef56',
    ])
    expect(rowNames()).toEqual(['New', 'Old'])
  })

  it('shows the URL, the status chip and the relative update', async () => {
    state.artifacts = [
      artifactSummary({
        name: 'Docs',
        url: 'https://ab12cd34ef56.artifacts.example',
        status: 'building',
        updatedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
      }),
    ]
    await mount()

    const text = document.body.textContent ?? ''
    expect(text).toContain('https://ab12cd34ef56.artifacts.example')
    expect(text).toContain('Building')
    expect(text).toContain('Updated 3h ago')
    expect(document.querySelector('[aria-label="Copy Docs URL"]')).not.toBeNull()
  })

  it('says what an artifact is when there are none', async () => {
    state.artifacts = []
    await mount()

    const text = document.body.textContent ?? ''
    expect(text).toContain('No artifacts yet')
    expect(text).toContain('static build an agent publishes')
  })
})
