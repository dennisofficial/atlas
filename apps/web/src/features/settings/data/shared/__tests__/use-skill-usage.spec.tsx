import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'
import type { Root } from 'react-dom/client'
import { EConfigLayer, ESkillOrigin, ESkillScope, type SkillLayer } from '@dltech/atlas-wire/web'
import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { createTestQueryClient, TestQueryProvider } from '@/lib/__tests__/query-test-provider'
import { useSkillLayers } from '../use-layers'

const originalFetch = globalThis.fetch
let root: Root | undefined

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => unregisterDom())
afterEach(async () => {
  await act(async () => root?.unmount())
  globalThis.fetch = originalFetch
})

const layers: SkillLayer[] = [
  EConfigLayer.BuiltIn,
  EConfigLayer.Personal,
  EConfigLayer.Group,
  EConfigLayer.Project,
].map((layer) => ({
  layer,
  owner: { id: layer, name: layer },
  items: [
    {
      name: 'review',
      description: '',
      fileCount: 1,
      sizeBytes: 1,
      updatedAt: '2026-11-27T00:00:00Z',
      origin: ESkillOrigin.Personal,
      usage: { usedCount30d: 0, lastUsedAt: null },
      usagePending: true,
      overridesBuiltIn: false,
      overriddenBy: null,
    },
  ],
}))

function Probe() {
  const query = useSkillLayers({ scope: ESkillScope.Project, projectId: 'project' })
  return (
    <div>
      {(query.data ?? []).map((layer) => (
        <span key={layer.layer} data-layer={layer.layer}>
          {layer.items[0]?.usagePending ? '—' : layer.items[0]?.usage.usedCount30d}
        </span>
      ))}
    </div>
  )
}

const flush = () => act(async () => new Promise((done) => setTimeout(done, 20)))

describe('layered skill usage', () => {
  it('deduplicates built-in and personal scans and lets each scope settle independently', async () => {
    const personal = Promise.withResolvers<Response>()
    const group = Promise.withResolvers<Response>()
    const calls: string[] = []
    globalThis.fetch = Object.assign(
      async (input: Parameters<typeof fetch>[0]) => {
        const url = new URL(String(input), 'http://test')
        calls.push(url.pathname)
        if (url.pathname.endsWith('skills.layered'))
          return Response.json({ result: { data: { layers } } })
        const scope = JSON.parse(url.searchParams.get('input') ?? '{}').scope
        if (scope === 'personal') return personal.promise
        if (scope === 'group') return group.promise
        return Response.json({
          result: { data: { usage: { review: { usedCount30d: 3, lastUsedAt: null } } } },
        })
      },
      { preconnect: originalFetch.preconnect },
    )
    const client = createTestQueryClient()
    const { createRoot } = await import('react-dom/client')
    const container = document.createElement('div')
    root = createRoot(container)
    const mounted = root
    await act(async () =>
      mounted.render(
        <TestQueryProvider client={client}>
          <Probe />
        </TestQueryProvider>,
      ),
    )
    await flush()
    await flush()
    expect(calls.filter((path) => path.endsWith('skills.usage'))).toHaveLength(3)
    expect(container.querySelector('[data-layer="personal"]')?.textContent).toBe('—')
    expect(container.querySelector('[data-layer="project"]')?.textContent).toBe('3')
    await act(async () =>
      personal.resolve(
        Response.json({
          result: { data: { usage: { review: { usedCount30d: 8, lastUsedAt: null } } } },
        }),
      ),
    )
    await act(async () => group.reject(new DOMException('Timed out', 'TimeoutError')))
    await flush()
    expect(container.querySelector('[data-layer="built-in"]')?.textContent).toBe('8')
    expect(container.querySelector('[data-layer="personal"]')?.textContent).toBe('8')
    expect(container.querySelector('[data-layer="group"]')?.textContent).toBe('—')
    expect(container.querySelector('[data-layer="project"]')?.textContent).toBe('3')
    client.clear()
  })
})
