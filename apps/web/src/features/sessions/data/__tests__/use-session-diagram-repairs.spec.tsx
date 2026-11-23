import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { act } from 'react'
import type { Root } from 'react-dom/client'

import { diagramKey, EDiagramRepair } from '@dltech/atlas-core'
import type {
  DiagramRepairInput,
  DiagramRepairListInput,
  DiagramRepairListOutput,
  DiagramRepairOutput,
} from '@dltech/atlas-protocol'

import { TestQueryProvider, createTestQueryClient } from '@/lib/__tests__/query-test-provider'

import type { SessionDiagramRepairs } from '../use-session-diagram-repairs'
import type { DiagramsApi } from '../sessions-api'

const BROKEN = 'flowchart LR\n  A[Start --> B{Check'
const FIXED = 'flowchart LR\n  A[Start] --> B{Check}'
const KEY = diagramKey(BROKEN)

const { REPAIRED_DIAGRAM_DOES_NOT_PARSE, useSessionDiagramRepairs } = await import(
  '../use-session-diagram-repairs'
)

let root: Root | null = null
let container: HTMLDivElement | null = null

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await unregisterDom()
})

afterEach(async () => {
  const mounted = root
  if (mounted !== null) await act(async () => mounted.unmount())
  root = null
  container?.remove()
  container = null
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

const flush = async () => {
  await act(async () => {
    await settle()
    await settle()
  })
}

const fakeApi = (args: {
  list?: (input: DiagramRepairListInput) => Promise<DiagramRepairListOutput>
  repair?: (input: DiagramRepairInput) => Promise<DiagramRepairOutput>
}): DiagramsApi => ({
  list: mock(args.list ?? (async () => ({ repairs: [] }))),
  repair: mock(
    args.repair ?? (async () => ({ kind: EDiagramRepair.Failed, reason: 'never called' })),
  ),
})

const mount = async (deps: {
  api: DiagramsApi
  validate: (source: string) => Promise<boolean>
}): Promise<() => SessionDiagramRepairs> => {
  const { createRoot } = await import('react-dom/client')
  const client = createTestQueryClient()
  const host = document.createElement('div')
  const instance = createRoot(host)
  let latest: SessionDiagramRepairs | undefined

  function Probe() {
    latest = useSessionDiagramRepairs({
      sessionId: 'ses-1',
      api: deps.api,
      validate: deps.validate,
    })
    return null
  }

  await act(async () =>
    instance.render(
      <TestQueryProvider client={client}>
        <Probe />
      </TestQueryProvider>,
    ),
  )
  root = instance
  container = host

  return () => {
    if (latest === undefined) throw new Error('the probe never rendered')
    return latest
  }
}

const repaired = (): DiagramRepairOutput => ({ kind: EDiagramRepair.Repaired, repaired: FIXED })

describe('useSessionDiagramRepairs', () => {
  it('applies a cached repair without asking the API again', async () => {
    const api = fakeApi({
      list: async () => ({ repairs: [{ source: BROKEN, outcome: repaired() }] }),
    })
    const read = await mount({ api, validate: async () => true })

    await flush()

    expect(api.list).toHaveBeenCalledWith({ sessionId: 'ses-1' })
    expect(api.repair).not.toHaveBeenCalled()
    expect(read().repairs.get(KEY)).toBe(FIXED)
  })

  it('keeps a cached repair out of the transcript when it does not parse', async () => {
    const api = fakeApi({
      list: async () => ({ repairs: [{ source: BROKEN, outcome: repaired() }] }),
    })
    const read = await mount({ api, validate: async () => false })

    await flush()

    expect(read().repairs.size).toBe(0)
  })

  it('asks once for the same chart, even when called twice', async () => {
    const api = fakeApi({ repair: async () => repaired() })
    const read = await mount({ api, validate: async () => true })
    await flush()

    await act(async () => {
      await Promise.all([
        read().repairDiagram({ messageId: 'm1', chart: BROKEN, error: 'Parse error' }),
        read().repairDiagram({ messageId: 'm1', chart: `  ${BROKEN}`, error: 'Parse error' }),
      ])
    })
    await flush()

    expect(api.repair).toHaveBeenCalledTimes(1)
    expect(api.repair).toHaveBeenCalledWith({
      sessionId: 'ses-1',
      source: BROKEN,
      error: 'Parse error',
      context: undefined,
    })
    expect(read().repairs.get(KEY)).toBe(FIXED)
  })

  it('never asks to repair a chart that is itself a repair', async () => {
    const api = fakeApi({ repair: async () => repaired() })
    const read = await mount({ api, validate: async () => true })
    await flush()

    await act(async () => {
      await read().repairDiagram({ messageId: 'm1', chart: BROKEN, error: 'Parse error' })
    })
    await flush()
    await act(async () => {
      await read().repairDiagram({ messageId: 'm1', chart: FIXED, error: 'Parse error' })
    })

    expect(api.repair).toHaveBeenCalledTimes(1)
  })

  it('never asks to repair a listed repair output after a reload', async () => {
    const api = fakeApi({
      list: async () => ({ repairs: [{ source: BROKEN, outcome: repaired() }] }),
    })
    const read = await mount({ api, validate: async () => true })
    await flush()

    await act(async () => {
      await read().repairDiagram({ messageId: 'm1', chart: FIXED, error: 'Parse error' })
    })

    expect(api.repair).not.toHaveBeenCalled()
  })

  it('passes the prose around the fence as context', async () => {
    const api = fakeApi({ repair: async () => repaired() })
    const read = await mount({ api, validate: async () => true })
    await flush()

    await act(async () => {
      await read().repairDiagram({
        messageId: 'm1',
        chart: BROKEN,
        error: 'Parse error',
        context: 'Before the diagram.',
      })
    })

    expect(api.repair).toHaveBeenCalledWith({
      sessionId: 'ses-1',
      source: BROKEN,
      error: 'Parse error',
      context: 'Before the diagram.',
    })
  })

  it('rejects a repair the browser cannot parse and keeps it out of the transcript', async () => {
    const api = fakeApi({ repair: async () => repaired() })
    const read = await mount({ api, validate: async () => false })
    await flush()

    let failure: unknown
    await act(async () => {
      await read()
        .repairDiagram({ messageId: 'm1', chart: BROKEN, error: 'Parse error' })
        .catch((reason: unknown) => {
          failure = reason
        })
    })

    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe(REPAIRED_DIAGRAM_DOES_NOT_PARSE)
    expect(read().repairs.size).toBe(0)
  })

  it('rejects with the stored failure reason', async () => {
    const api = fakeApi({
      list: async () => ({
        repairs: [
          { source: BROKEN, outcome: { kind: EDiagramRepair.Failed, reason: 'no diagram' } },
        ],
      }),
    })
    const read = await mount({ api, validate: async () => true })
    await flush()

    let failure: unknown
    await act(async () => {
      await read()
        .repairDiagram({ messageId: 'm1', chart: BROKEN, error: 'Parse error' })
        .catch((reason: unknown) => {
          failure = reason
        })
    })

    expect((failure as Error).message).toBe('no diagram')
    expect(api.repair).not.toHaveBeenCalled()
  })
})
