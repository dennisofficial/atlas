import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
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
import { EMPTY_DETAILS } from '../details/details-input'

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
  openDetails: () => undefined,
  details: EMPTY_DETAILS,
  clearAgent: () => undefined,
  contextPath: undefined,
  openContextFile: () => undefined,
  closeContextFile: () => undefined,
  closePanel: () => undefined,
  refreshPod: () => undefined,
}

const mounted: Array<() => void> = []

afterEach(async () => {
  for (const unmount of mounted.splice(0)) await act(async () => unmount())
})

async function mount(data: ProcessesData, declared: ReadonlySet<string> = new Set()) {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mounted.push(() => {
    root.unmount()
    container.remove()
  })
  await act(async () => root.render(<ProcessesList data={data} declared={declared} />))
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
    const html = renderToStaticMarkup(<ProcessesList data={dataOf()} declared={new Set()} />)
    expect(html).toContain('Nothing is running in the background.')
    expect(html).toContain('Nothing is running as a service.')
  })

  it('renders a Kill button only for running shells and calls handleKill', async () => {
    const killed: string[] = []
    const container = await mount(
      dataOf({
        shells: [
          shell(),
          shell({
            shellId: 'shell_2',
            status: EShellStatus.Exited,
            exitCode: 0,
          }),
        ],
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
      <ProcessesList
        data={dataOf({ shells: [shell({ awaitingInput: true })] })}
        declared={new Set()}
      />,
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
    const html = renderToStaticMarkup(
      <ProcessesList data={dataOf({ notice: 'no such shell' })} declared={new Set()} />,
    )
    expect(html).toContain('no such shell')
  })

  it('renders a Stop button for a running service and calls handleStop', async () => {
    const stopped: string[] = []
    const container = await mount(
      dataOf({
        services: [service()],
        handleStop: async (serviceId) => {
          stopped.push(serviceId)
        },
      }),
    )
    const stop = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Stop',
    )
    await click(stop)
    expect(stopped).toEqual(['svc_1'])
  })

  it('runs a command, clears the field on success and keeps it after a refusal', async () => {
    const commands: string[] = []
    let accepted = true
    const container = await mount(
      dataOf({
        handleStart: async (command) => {
          commands.push(command)
          return accepted
        },
      }),
    )
    const input = container.querySelector('input')
    const form = container.querySelector('form')
    const type = async (value: string) =>
      act(async () => {
        if (input === null) return
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        setter?.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
    const submit = async () =>
      act(async () => {
        form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
        await Bun.sleep(0)
      })
    await type('  ls -la ')
    await submit()
    expect(commands).toEqual(['ls -la'])
    expect(input?.value).toBe('')
    accepted = false
    await type('false')
    await submit()
    expect(commands).toEqual(['ls -la', 'false'])
    expect(input?.value).toBe('false')
    const run = container.querySelector('button[type="submit"]')
    expect(run?.hasAttribute('disabled')).toBe(false)
  })

  it('selects a collapsed row on click', async () => {
    const chosen: Array<ProcessRef | null> = []
    const container = await mount(
      dataOf({ shells: [shell()], handleSelect: (ref) => chosen.push(ref) }),
    )
    await click(container.querySelector('[aria-expanded="false"]'))
    expect(chosen).toEqual([{ kind: EProcessKind.Shell, id: 'shell_1' }])
  })
  it('hides declared services but keeps one-off services', async () => {
    const container = await mount(
      dataOf({
        services: [
          service({ serviceId: 'svc_web', name: 'web', description: 'Declared web' }),
          service({ serviceId: 'svc_once', name: 'once', description: 'One-off job' }),
        ],
      }),
      new Set(['web']),
    )
    expect(container.textContent).toContain('One-off job')
    expect(container.textContent).not.toContain('Declared web')
    expect(container.querySelectorAll('[aria-expanded]')).toHaveLength(1)
  })

  it('still lists a declared service while its log is selected', async () => {
    const container = await mount(
      dataOf({
        services: [service({ serviceId: 'svc_web', name: 'web' })],
        selected: { kind: EProcessKind.Service, id: 'svc_web' },
        log: 'listening',
      }),
      new Set(['web']),
    )
    expect(container.textContent).toContain('listening')
  })
})
