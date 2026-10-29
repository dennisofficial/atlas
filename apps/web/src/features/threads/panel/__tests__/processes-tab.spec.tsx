import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  EServiceStatus,
  EShellStatus,
  serviceSnapshotWireSchema,
  shellSnapshotWireSchema,
  type ServiceSnapshotWire,
  type ShellSnapshotWire,
} from '@dltech/atlas-wire/web'

import { EProcessKind, type ProcessRef } from '../../data/processes-model'
import type { ProcessesData } from '../../data/use-processes'
import { ProcessesList, ProcessesTab } from '../processes-tab'
import { ThreadPanelProvider, type ThreadPanelValue } from '../thread-panel-context'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

const shell = (over: Partial<Record<string, unknown>> = {}): ShellSnapshotWire =>
  shellSnapshotWireSchema.parse({
    shellId: 'shell_1',
    threadId: 'thr_1',
    command: 'bun run dev',
    description: 'Dev server',
    status: EShellStatus.Running,
    startedAt: '2026-10-28T00:00:00.000Z',
    lastOutputAt: '2026-10-28T00:00:01.000Z',
    totalCharacters: 0,
    awaitingInput: false,
    ...over,
  })

const service = (over: Partial<Record<string, unknown>> = {}): ServiceSnapshotWire =>
  serviceSnapshotWireSchema.parse({
    serviceId: 'svc_1',
    command: 'postgres',
    description: 'Database',
    status: EServiceStatus.Running,
    logPath: '/tmp/svc_1.log',
    startedAt: '2026-10-28T00:00:00.000Z',
    ...over,
  })

const dataOf = (over: Partial<ProcessesData> = {}): ProcessesData => ({
  loaded: true,
  shells: [],
  services: [],
  busyId: null,
  notice: null,
  selected: null,
  log: null,
  handleSelect: () => undefined,
  handleKill: async () => undefined,
  handleStop: async () => undefined,
  handleStart: async () => true,
  ...over,
})

const panel: ThreadPanelValue = {
  threadId: 'thr_1',
  channel: null,
  pod: null,
  working: false,
  changesPath: undefined,
  agentId: undefined,
  openChanges: () => undefined,
  openAgent: () => undefined,
  clearAgent: () => undefined,
  closePanel: () => undefined,
  refreshPod: () => undefined,
}

async function mount(data: ProcessesData) {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(<ProcessesList data={data} />))
  return container
}

const click = async (element: Element | null | undefined) =>
  act(async () => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })

describe('ProcessesTab', () => {
  it('waits for the pod without a channel', () => {
    const html = renderToStaticMarkup(
      <ThreadPanelProvider value={panel}>
        <ProcessesTab />
      </ThreadPanelProvider>,
    )
    expect(html).toContain('Connecting to the pod')
  })

  it('renders the empty lines when nothing is running', () => {
    const html = renderToStaticMarkup(<ProcessesList data={dataOf()} />)
    expect(html).toContain('Nothing is running in the background.')
    expect(html).toContain('Nothing is running as a service.')
  })

  it('renders a Kill button only for running shells and calls handleKill', async () => {
    const killed: string[] = []
    const container = await mount(
      dataOf({
        shells: [shell(), shell({ shellId: 'shell_2', status: EShellStatus.Exited, exitCode: 0 })],
        handleKill: async (shellId) => {
          killed.push(shellId)
        },
      }),
    )
    const kills = [...container.querySelectorAll('button')].filter(
      (button) => button.textContent === 'Kill',
    )
    expect(kills).toHaveLength(1)
    await click(kills[0])
    expect(killed).toEqual(['shell_1'])
  })

  it('disables Kill and Stop while an action is in flight', async () => {
    const container = await mount(
      dataOf({ shells: [shell()], services: [service()], busyId: 'shell_1' }),
    )
    const actions = [...container.querySelectorAll('button')].filter((button) =>
      ['Kill', 'Stop'].includes(button.textContent ?? ''),
    )
    expect(actions).toHaveLength(2)
    expect(actions.every((button) => button.disabled)).toBe(true)
  })

  it('shows the stdin-closed warning for an awaiting-input shell', () => {
    const html = renderToStaticMarkup(
      <ProcessesList data={dataOf({ shells: [shell({ awaitingInput: true })] })} />,
    )
    expect(html).toContain('Its stdin is closed, so nothing can answer it.')
  })

  it('expands the log under the selected row with the empty-output line', async () => {
    const chosen: Array<ProcessRef | null> = []
    const container = await mount(
      dataOf({
        shells: [shell()],
        selected: { kind: EProcessKind.Shell, id: 'shell_1' },
        log: '',
        handleSelect: (ref) => chosen.push(ref),
      }),
    )
    expect(container.textContent).toContain('It has printed nothing yet.')
    const toggle = container.querySelector('[aria-expanded="true"]')
    expect(toggle).not.toBeNull()
    await click(toggle)
    expect(chosen).toEqual([null])
  })

  it('surfaces the notice', () => {
    const html = renderToStaticMarkup(<ProcessesList data={dataOf({ notice: 'no such shell' })} />)
    expect(html).toContain('no such shell')
  })
})
