import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'

import { createTestQueryClient, TestQueryProvider } from './query-test-provider'
import { EQueryState, useCloudQuery, type CloudQuery } from '../use-cloud-query'

type Mounted = {
  rerender: (key: string) => Promise<void>
  latest: () => CloudQuery<string>
  unmount: () => Promise<void>
}

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

const flush = () => act(async () => new Promise<void>((done) => setTimeout(done, 10)))

async function mount(load: (key: string) => Promise<string>): Promise<Mounted> {
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(document.createElement('div'))
  const client = createTestQueryClient()
  let latest: CloudQuery<string> | null = null

  function Probe({ queryKey }: { queryKey: string }) {
    latest = useCloudQuery({ key: queryKey, load: () => load(queryKey) })
    return null
  }

  const rerender = async (key: string) => {
    await act(async () =>
      root.render(
        <TestQueryProvider client={client}>
          <Probe queryKey={key} />
        </TestQueryProvider>,
      ),
    )
    await flush()
  }
  return {
    rerender,
    latest: () => {
      if (latest === null) throw new Error('the probe never rendered')
      return latest
    },
    unmount: async () => {
      await act(async () => root.unmount())
    },
  }
}

describe('useCloudQuery', () => {
  it('loads once however many renders hand it a fresh load function', async () => {
    const calls: string[] = []
    const probe = await mount(async (key) => {
      calls.push(key)
      return `data:${key}`
    })

    await probe.rerender('thr_1')
    await probe.rerender('thr_1')
    await probe.rerender('thr_1')

    expect(calls).toEqual(['thr_1'])
    expect(probe.latest()).toMatchObject({ state: EQueryState.Ready, data: 'data:thr_1' })
    await probe.unmount()
  })

  it('loads again when the key changes, through the latest load', async () => {
    const calls: string[] = []
    const probe = await mount(async (key) => {
      calls.push(key)
      return `data:${key}`
    })

    await probe.rerender('thr_1')
    await probe.rerender('thr_2')

    expect(calls).toEqual(['thr_1', 'thr_2'])
    expect(probe.latest()).toMatchObject({ state: EQueryState.Ready, data: 'data:thr_2' })
    await probe.unmount()
  })

  it('loads again on reload', async () => {
    const calls: string[] = []
    const probe = await mount(async (key) => {
      calls.push(key)
      return `data:${key}`
    })

    await probe.rerender('thr_1')
    await act(async () => probe.latest().reload())
    await flush()

    expect(calls).toEqual(['thr_1', 'thr_1'])
    await probe.unmount()
  })

  it('keeps the old data visible while a same-key reload is in flight', async () => {
    let release: (value: string) => void = () => undefined
    let first = true
    const probe = await mount((key) => {
      if (first) {
        first = false
        return Promise.resolve(`old:${key}`)
      }
      return new Promise<string>((resolve) => {
        release = resolve
      })
    })

    await probe.rerender('thr_1')
    await act(async () => probe.latest().reload())

    expect(probe.latest()).toMatchObject({ state: EQueryState.Ready, data: 'old:thr_1' })
    await act(async () => release('new:thr_1'))
    await flush()
    expect(probe.latest()).toMatchObject({ state: EQueryState.Ready, data: 'new:thr_1' })
    await probe.unmount()
  })

  it('makes one load call for two components sharing a key', async () => {
    const calls: string[] = []
    const client = createTestQueryClient()
    const { createRoot } = await import('react-dom/client')
    const root = createRoot(document.createElement('div'))
    function Probe() {
      useCloudQuery({
        key: 'shared',
        load: async () => {
          calls.push('shared')
          return 'value'
        },
      })
      return null
    }
    await act(async () =>
      root.render(
        <TestQueryProvider client={client}>
          <Probe />
          <Probe />
        </TestQueryProvider>,
      ),
    )
    await flush()

    expect(calls).toEqual(['shared'])
    await act(async () => root.unmount())
  })

  it('surfaces a rejected load as a CloudApiError', async () => {
    const probe = await mount(async () => {
      throw new Error('boom')
    })
    await probe.rerender('thr_1')

    const result = probe.latest()
    expect(result.state).toBe(EQueryState.Failed)
    expect(result.error?.message).toBe('boom')
    await probe.unmount()
  })

  it('stays ready with the old data when a background refetch fails', async () => {
    let calls = 0
    const probe = await mount(async (key) => {
      calls += 1
      if (calls > 1) throw new Error('502')
      return `data:${key}`
    })

    await probe.rerender('thr_1')
    await act(async () => probe.latest().reload())
    await flush()

    expect(probe.latest()).toMatchObject({ state: EQueryState.Ready, data: 'data:thr_1' })
    await probe.unmount()
  })
})
