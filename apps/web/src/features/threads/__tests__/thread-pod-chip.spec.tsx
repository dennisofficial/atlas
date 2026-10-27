import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { act, useState } from 'react'

import { ResizeDeclinedError } from '@dltech/atlas-ui/ai/pod-status-chip'
import { EPodState, type PodStatus } from '@dltech/atlas-wire/web'

import { ThreadPodChip, useResizeConfirmation } from '../thread-pod-chip'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

afterEach(() => {
  document.body.innerHTML = ''
})

const mount = async (element: React.ReactElement) => {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(element))
  return () => act(async () => root.unmount())
}

const click = (element: Element | null | undefined) =>
  act(async () => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })

const buttonNamed = (name: string) =>
  [...document.body.querySelectorAll('button')].find((button) => button.textContent?.includes(name))

function Harness(props: { working: boolean; onResize: (vcpus: number) => Promise<void> }) {
  const { confirmation, handleResize } = useResizeConfirmation(props)
  const [outcome, setOutcome] = useState('pending')
  const handleStart = () =>
    handleResize(8).then(
      () => setOutcome('applied'),
      (failure: unknown) =>
        setOutcome(failure instanceof ResizeDeclinedError ? 'declined' : 'failed'),
    )
  return (
    <>
      <button type="button" onClick={handleStart}>
        start
      </button>
      <output>{outcome}</output>
      <output>{confirmation === null ? 'closed' : 'asking'}</output>
      <button type="button" onClick={() => confirmation?.accept()}>
        accept
      </button>
      <button type="button" onClick={() => confirmation?.decline()}>
        decline
      </button>
    </>
  )
}

describe('ThreadPodChip', () => {
  it('renders nothing until the pod has a size', async () => {
    const pod: PodStatus = { state: EPodState.None, steps: [] }
    const unmount = await mount(
      <ThreadPodChip pod={null} working={false} onResize={async () => undefined} />,
    )
    expect(document.body.textContent).toBe('')
    await unmount()
    const none = await mount(
      <ThreadPodChip pod={pod} working={false} onResize={async () => undefined} />,
    )
    expect(document.body.textContent).toBe('')
    await none()
  })

  it('shows the size of a running pod', async () => {
    const pod: PodStatus = {
      state: EPodState.Running,
      resources: { sandboxId: 'sbx_1', region: 'iad1', vcpus: 2 },
      steps: [],
    }
    const unmount = await mount(
      <ThreadPodChip pod={pod} working={false} onResize={async () => undefined} />,
    )
    expect(document.body.textContent).toContain('2 vCPU · 4 GB')
    await unmount()
  })
})

describe('useResizeConfirmation', () => {
  it('resizes at once while the thread is idle', async () => {
    const onResize = mock(() => Promise.resolve())
    const unmount = await mount(<Harness working={false} onResize={onResize} />)
    await click(buttonNamed('start'))
    expect(onResize).toHaveBeenCalledWith(8)
    expect(document.body.textContent).toContain('closed')
    expect(document.body.textContent).toContain('applied')
    await unmount()
  })

  it('confirms first mid-turn and resizes only on Restart', async () => {
    const onResize = mock(() => Promise.resolve())
    const unmount = await mount(<Harness working onResize={onResize} />)
    await click(buttonNamed('start'))
    expect(document.body.textContent).toContain('asking')
    expect(onResize).not.toHaveBeenCalled()
    await click(buttonNamed('accept'))
    expect(onResize).toHaveBeenCalledWith(8)
    expect(document.body.textContent).toContain('applied')
    await unmount()
  })

  it('declines quietly when the confirmation is cancelled', async () => {
    const onResize = mock(() => Promise.resolve())
    const unmount = await mount(<Harness working onResize={onResize} />)
    await click(buttonNamed('start'))
    await click(buttonNamed('decline'))
    expect(onResize).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('declined')
    await unmount()
  })
})
