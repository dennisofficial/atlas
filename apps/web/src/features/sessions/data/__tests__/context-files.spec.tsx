import { afterAll, afterEach, beforeAll, describe, expect, it, spyOn } from 'bun:test'
import { toEventId, toRunId, toThreadId, type Hash, type V2Event } from '@dltech/atlas-core'
import { act } from 'react'

import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { createTestQueryClient } from '@/lib/__tests__/query-test-provider'

import { sessionEventSchema, sessionEventTypes } from '../../registered-plugins'
import {
  type ContextChange,
  contextChangesOf,
  contextFileKey,
  contextFilesKey,
  contextMirrorKey,
  contextTreeOf,
  useContextMirrorRefresh,
} from '../context-files'

const mounted: Array<() => void> = []

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await unregisterDom()
})

afterEach(async () => {
  for (const unmount of mounted.splice(0)) await act(async () => unmount())
})

const eventOf = (seq: number, paths: string[]): V2Event => ({
  id: toEventId(`t:${seq}`),
  seq,
  threadId: toThreadId('t'),
  runId: toRunId('r'),
  depth: 0,
  at: '2026-11-23T12:00:00.000Z',
  epoch: 1,
  prevHash: 'a'.repeat(64) as Hash,
  type: 'context-changed',
  paths,
})

describe('contextTreeOf', () => {
  it('lists the files and folders of the requested directory', () => {
    const tree = contextTreeOf({
      files: [{ path: 'plan.md' }, { path: 'sections/01-store.md' }, { path: 'sections/02.md' }],
      directory: '',
    })

    expect(tree).toEqual([
      { name: 'sections', isDirectory: true },
      { name: 'plan.md', isDirectory: false },
    ])
  })

  it('lists one entry per folder however many files it holds', () => {
    const tree = contextTreeOf({
      files: [{ path: 'a/one.md' }, { path: 'a/two/three.md' }],
      directory: '',
    })

    expect(tree).toEqual([{ name: 'a', isDirectory: true }])
  })

  it('narrows to the files under a subdirectory', () => {
    const tree = contextTreeOf({
      files: [{ path: 'plan.md' }, { path: 'sections/01-store.md' }],
      directory: 'sections',
    })

    expect(tree).toEqual([{ name: '01-store.md', isDirectory: false }])
  })

  it('prefers a folder over a file of the same name', () => {
    const tree = contextTreeOf({
      files: [{ path: 'notes' }, { path: 'notes/one.md' }],
      directory: '',
    })

    expect(tree).toEqual([{ name: 'notes', isDirectory: true }])
  })
})

describe('contextChangesOf', () => {
  it('collects the paths of every context change and names the newest seq', () => {
    const change = contextChangesOf([
      eventOf(1, ['plan.md']),
      eventOf(2, ['sections/01.md', 'plan.md']),
      { type: 'user-said', seq: 3 } as unknown as V2Event,
      eventOf(4, ['sections/02.md']),
    ])

    expect(change).toEqual({
      seq: 4,
      paths: ['plan.md', 'sections/01.md', 'sections/02.md'],
    })
  })

  it('answers nothing when no context change arrived', () => {
    expect(contextChangesOf([])).toBeUndefined()
  })

  it('reaches the web stream as a known event', () => {
    expect(sessionEventTypes.has('context-changed')).toBe(true)
    expect(sessionEventSchema.safeParse(eventOf(1, ['plan.md'])).success).toBe(true)
  })
})

const RefreshHost = (props: { changed: ContextChange | undefined; turnEnds: number }) => {
  useContextMirrorRefresh({
    sessionId: 'ses-1',
    changed: props.changed,
    turnEnds: props.turnEnds,
  })
  return null
}

const mountRefresh = async () => {
  const client = createTestQueryClient()
  const invalidated: unknown[] = []
  const invalidate = client.invalidateQueries.bind(client)
  spyOn(client, 'invalidateQueries').mockImplementation((filters) => {
    invalidated.push(filters?.queryKey)
    return invalidate(filters)
  })
  const { createRoot } = await import('react-dom/client')
  const { QueryClientProvider } = await import('@tanstack/react-query')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mounted.push(() => {
    root.unmount()
    container.remove()
  })
  const render = (props: { changed: ContextChange | undefined; turnEnds: number }) =>
    act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <RefreshHost changed={props.changed} turnEnds={props.turnEnds} />
        </QueryClientProvider>,
      ),
    )
  return { invalidated, render }
}

describe('useContextMirrorRefresh', () => {
  it('invalidates the listing and every changed file once', async () => {
    const { invalidated, render } = await mountRefresh()
    const changed = { seq: 4, paths: ['plan.md', 'sections/01.md'] }

    await render({ changed: undefined, turnEnds: 0 })
    await render({ changed, turnEnds: 0 })
    await render({ changed, turnEnds: 0 })

    expect(invalidated).toEqual([
      contextMirrorKey('ses-1'),
      contextFileKey({ sessionId: 'ses-1', path: 'plan.md' }),
      contextFileKey({ sessionId: 'ses-1', path: 'sections/01.md' }),
    ])
  })

  it('invalidates the listing and the open file when a turn ends', async () => {
    const { invalidated, render } = await mountRefresh()

    await render({ changed: undefined, turnEnds: 0 })
    await render({ changed: undefined, turnEnds: 1 })
    await render({ changed: undefined, turnEnds: 1 })

    expect(invalidated).toEqual([contextMirrorKey('ses-1'), contextFilesKey('ses-1')])
  })
})
