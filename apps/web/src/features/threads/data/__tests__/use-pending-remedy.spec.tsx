import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'

import { ERunRemedy } from '@dltech/atlas-core'

import { usePendingRemedy } from '../use-pending-remedy'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

const unmounts: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const unmount of unmounts.splice(0)) await unmount()
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

type Api = ReturnType<typeof usePendingRemedy>

async function mount(args: { key: string | null; working: boolean }) {
  const { createRoot } = await import('react-dom/client')
  const box: { api: Api | null } = { api: null }
  function Probe(props: { keyed: string | null; working: boolean }) {
    box.api = usePendingRemedy({ key: props.keyed, working: props.working })
    return null
  }
  const root = createRoot(document.createElement('div'))
  const render = (next: { key: string | null; working: boolean }) =>
    act(async () => root.render(<Probe keyed={next.key} working={next.working} />))
  unmounts.push(() => act(async () => root.unmount()))
  await render(args)
  return { box, render }
}

describe('usePendingRemedy', () => {
  it('lets only the first click through until working or a new attention', async () => {
    const { box, render } = await mount({ key: '3:none', working: false })
    let sends = 0
    const click = () => {
      if (box.api?.begin(ERunRemedy.Retry) === true) sends += 1
    }
    await act(async () => click())
    await act(async () => click())
    expect(sends).toBe(1)
    expect(box.api?.pending).toBe(ERunRemedy.Retry)

    await render({ key: '3:none', working: true })
    expect(box.api?.pending).toBeNull()
    await render({ key: '3:none', working: false })
    await act(async () => click())
    expect(sends).toBe(2)

    await render({ key: '9:none', working: false })
    expect(box.api?.pending).toBeNull()
    await act(async () => click())
    expect(sends).toBe(3)
  })

  it('allows a new click after a failed send clears the pending state', async () => {
    const { box } = await mount({ key: '3:none', working: false })
    await act(async () => void box.api?.begin(ERunRemedy.Resume))
    await act(async () => box.api?.clear())
    expect(box.api?.pending).toBeNull()
    expect(box.api?.begin(ERunRemedy.Resume)).toBe(true)
  })
})
