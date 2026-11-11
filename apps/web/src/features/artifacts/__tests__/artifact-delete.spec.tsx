import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { act } from 'react'
import type { Root } from 'react-dom/client'

import type { ArtifactSummary } from '@dltech/atlas-wire/web'

import { createTestQueryClient, TestQueryProvider } from '@/lib/__tests__/query-test-provider'

import { artifactSummary, buildSummary } from './fixtures'

const calls = { list: 0, deleted: 0 }
const pushed: string[] = []
const state: { artifacts: ArtifactSummary[] } = { artifacts: [] }

mock.module('next/navigation', () => ({
  useRouter: () => ({ push: (href: string) => pushed.push(href) }),
}))

mock.module('../artifacts-api', () => ({
  ARTIFACTS_KEY: 'artifacts',
  artifactKeyOf: (slug: string) => `artifact:${slug}`,
  fetchArtifacts: async () => {
    calls.list += 1
    return { artifacts: state.artifacts }
  },
  fetchArtifact: async () => ({ artifact: artifactSummary(), build: buildSummary() }),
  deleteArtifact: async () => {
    calls.deleted += 1
    state.artifacts = []
    return { ok: true }
  },
}))

const { ArtifactsView } = await import('../artifacts-view')
const { useArtifactActions } = await import('../artifact-actions')

function DeleteProbe({ target }: { target: string }) {
  const { handleDelete } = useArtifactActions({ ref: target })
  return (
    <button type="button" onClick={() => void handleDelete()}>
      delete
    </button>
  )
}

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
  calls.list = 0
  calls.deleted = 0
  pushed.length = 0
})

const settle = (ms = 40) =>
  act(async () => void (await new Promise((done) => setTimeout(done, ms))))

describe('deleting an artifact', () => {
  it('refetches the list so the deleted artifact does not linger', async () => {
    state.artifacts = [artifactSummary({ name: 'Gone' })]
    const { createRoot } = await import('react-dom/client')
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () =>
      root?.render(
        <TestQueryProvider client={createTestQueryClient()}>
          <ArtifactsView />
          <DeleteProbe target="ab12cd34ef56" />
        </TestQueryProvider>,
      ),
    )
    await settle()
    expect(document.body.textContent).toContain('Gone')
    const loadsBefore = calls.list

    const button = [...document.querySelectorAll('button')].find(
      (element) => element.textContent === 'delete',
    )
    await act(async () => button?.click())
    await settle()

    expect(calls.deleted).toBe(1)
    expect(calls.list).toBeGreaterThan(loadsBefore)
    expect(document.body.textContent).not.toContain('Gone')
    expect(pushed).toEqual(['/artifacts'])
  })
})
