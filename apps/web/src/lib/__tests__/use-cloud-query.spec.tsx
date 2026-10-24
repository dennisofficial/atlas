import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'

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

async function mount(load: (key: string) => Promise<string>): Promise<Mounted> {
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(document.createElement('div'))
  let latest: CloudQuery<string> | null = null

  function Probe({ queryKey }: { queryKey: string }) {
    latest = useCloudQuery({ key: queryKey, load: () => load(queryKey) })
    return null
  }

  const rerender = async (key: string) => {
    await act(async () => root.render(<Probe queryKey={key} />))
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

    expect(calls).toEqual(['thr_1', 'thr_1'])
    await probe.unmount()
  })
})
