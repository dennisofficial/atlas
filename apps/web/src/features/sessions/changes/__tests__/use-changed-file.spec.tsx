import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { EChangeFileStatus, type ChangedFile } from '@dltech/atlas-protocol'
import { act } from 'react'
import type { Root } from 'react-dom/client'

const BODIES: Record<string, string> = { 'base-hash': 'a\nb\n', 'current-hash': 'a\nx\n' }
const signed: string[] = []

mock.module('@/features/sessions/changes/changes-api', () => ({
  fetchChanges: async () => ({ checkouts: [] }),
  fetchChangeContent: async (args: { path: string; side: string; [key: string]: unknown }) => {
    const hash = args.side === 'base' ? 'base-hash' : 'current-hash'
    return { url: `https://signed.test/${hash}`, hash, size: 4, validUntil: 0 }
  },
}))

const { loadDiff, resetChangeCaches, useChangedFile } = await import('../use-changed-file')

const realFetch = globalThis.fetch

const file = (overrides: Partial<ChangedFile> = {}): ChangedFile => ({
  path: 'src/app.ts',
  oldPath: null,
  status: EChangeFileStatus.Modified,
  additions: 1,
  deletions: 1,
  binary: false,
  size: 8,
  baseHash: 'base-hash',
  currentHash: 'current-hash',
  ...overrides,
})

const roots = new Set<Root>()

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  globalThis.fetch = realFetch
  await unregisterDom()
})

beforeEach(() => {
  resetChangeCaches()
  signed.length = 0
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input)
    signed.push(url)
    const hash = url.split('/').at(-1) ?? ''
    return new Response(BODIES[hash] ?? '')
  }) as typeof fetch
})

afterEach(async () => {
  for (const root of roots) await act(async () => root.unmount())
  roots.clear()
})

describe('loadDiff', () => {
  it('fetches each side through its signed URL once per hash', async () => {
    const lines = await loadDiff({ sessionId: 'ses-1', checkoutId: 'co-1', file: file() })
    expect(lines).toEqual([
      { kind: 'gap', text: '1 unchanged line' },
      { kind: 'remove', text: 'b', oldNumber: 2 },
      { kind: 'add', text: 'x', newNumber: 2 },
      { kind: 'gap', text: '1 unchanged line' },
    ])
    expect(signed).toEqual(['https://signed.test/base-hash', 'https://signed.test/current-hash'])
  })

  it('reuses a cached diff for the same two hashes', async () => {
    await loadDiff({ sessionId: 'ses-1', checkoutId: 'co-1', file: file() })
    await loadDiff({ sessionId: 'ses-1', checkoutId: 'co-2', file: file({ path: 'src/other.ts' }) })
    expect(signed.length).toBe(2)
  })

  it('reads a deleted file as empty on its current side', async () => {
    const lines = await loadDiff({
      sessionId: 'ses-1',
      checkoutId: 'co-1',
      file: file({ status: EChangeFileStatus.Deleted, currentHash: null }),
    })
    expect(signed).toEqual(['https://signed.test/base-hash'])
    expect(lines.some((line) => line.kind === 'remove')).toBe(true)
  })
})

describe('useChangedFile', () => {
  it('shows a spinner, then the diff of an expanded file', async () => {
    const states: string[] = []
    function Probe() {
      const state = useChangedFile({ sessionId: 'ses-1', checkoutId: 'co-1', file: file() })
      states.push(state.status)
      return <span>{state.status === 'ready' ? `${state.lines.length} lines` : state.status}</span>
    }
    const { createRoot } = await import('react-dom/client')
    const container = document.createElement('div')
    const root = createRoot(container)
    roots.add(root)
    await act(async () => root.render(<Probe />))
    await act(async () => undefined)
    expect(states.includes('loading')).toBe(true)
    expect(states.at(-1)).toBe('ready')
    expect(container.textContent).toBe('4 lines')
  })
})
