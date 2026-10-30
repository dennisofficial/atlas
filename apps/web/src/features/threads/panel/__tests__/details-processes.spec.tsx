import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'

import {
  EServiceStatus,
  EShellStatus,
  serviceSnapshotWireSchema,
  shellSnapshotWireSchema,
  type DeclaredServicesViewWire,
} from '@dltech/atlas-wire/web'

import { EProcessKind, type ProcessRef } from '../../data/processes-model'
import type { DeclaredServicesData } from '../../data/use-declared-services'
import type { ProcessesData } from '../../data/use-processes'
import { ProcessLogSheet } from '../details/process-log-sheet'
import { adhocFoldOf, BackgroundSection } from '../details/processes-sections'
import { ServicesSection } from '../details/services-section'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

const mounted: Array<() => void> = []

afterEach(async () => {
  for (const unmount of mounted.splice(0)) await act(async () => unmount())
})

const shell = (over: Partial<Record<string, unknown>> = {}) =>
  shellSnapshotWireSchema.parse({
    shellId: 'shell_1',
    threadId: 'thr_1',
    command: 'bun run dev',
    description: 'Dev server',
    status: EShellStatus.Running,
    startedAt: '2026-10-28T00:00:00.000Z',
    lastOutputAt: '2026-10-28T00:00:01.000Z',
    totalCharacters: 12,
    awaitingInput: false,
    ...over,
  })

const service = (over: Partial<Record<string, unknown>> = {}) =>
  serviceSnapshotWireSchema.parse({
    serviceId: 'svc_once',
    name: 'once',
    command: 'sleep 100',
    description: 'One-off job',
    status: EServiceStatus.Running,
    logPath: '/tmp/svc.log',
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

const declaredData: DeclaredServicesData = {
  view: { services: [], rejections: [] } as unknown as DeclaredServicesViewWire,
  busyName: null,
  error: null,
  handleStart: async () => undefined,
  handleStop: async () => undefined,
  handleRestart: async () => undefined,
}

async function mount(node: React.ReactNode) {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mounted.push(() => {
    root.unmount()
    container.remove()
  })
  await act(async () => root.render(node))
  return container
}

const click = async (element: Element | null | undefined) =>
  act(async () => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })

const servicesOf = (data: ProcessesData, declared: ReadonlySet<string> = new Set()) => (
  <ServicesSection
    data={declaredData}
    onOpenLog={() => undefined}
    adhoc={{ data, fold: adhocFoldOf({ data, declared }) }}
  />
)

describe('ad-hoc services in Details', () => {
  it('lists an undeclared service marked ad-hoc with a Stop action', async () => {
    const stopped: string[] = []
    const container = await mount(
      servicesOf(
        dataOf({
          services: [service()],
          handleStop: async (id) => {
            stopped.push(id)
          },
        }),
      ),
    )
    expect(container.textContent).toContain('ad-hoc')
    expect(container.textContent).toContain('One-off job')
    await click(container.querySelector('[aria-label="Stop One-off job"]'))
    expect(stopped).toEqual(['svc_once'])
  })

  it('leaves out services that are declared', async () => {
    const container = await mount(
      servicesOf(dataOf({ services: [service({ name: 'web' })] }), new Set(['web'])),
    )
    expect(container.textContent).not.toContain('ad-hoc')
    expect(container.querySelector('section')).toBeNull()
  })

  it('selects the service when its log button is clicked', async () => {
    const chosen: Array<ProcessRef | null> = []
    const container = await mount(
      servicesOf(dataOf({ services: [service()], handleSelect: (ref) => chosen.push(ref) })),
    )
    await click(container.querySelector('[aria-label="Open One-off job log"]'))
    expect(chosen).toEqual([{ kind: EProcessKind.Service, id: 'svc_once' }])
  })
})

describe('Background section', () => {
  it('is hidden when no shell is running', async () => {
    const container = await mount(
      <BackgroundSection
        data={dataOf({ shells: [shell({ status: EShellStatus.Exited, exitCode: 0 })] })}
      />,
    )
    expect(container.querySelector('section')).toBeNull()
  })

  it('lists running shells with Kill and log actions', async () => {
    const killed: string[] = []
    const chosen: Array<ProcessRef | null> = []
    const container = await mount(
      <BackgroundSection
        data={dataOf({
          shells: [shell()],
          handleKill: async (id) => {
            killed.push(id)
          },
          handleSelect: (ref) => chosen.push(ref),
        })}
      />,
    )
    expect(container.textContent).toContain('Background')
    await click(container.querySelector('[aria-label="Kill Dev server"]'))
    await click(container.querySelector('[aria-label="Open Dev server log"]'))
    expect(killed).toEqual(['shell_1'])
    expect(chosen).toEqual([{ kind: EProcessKind.Shell, id: 'shell_1' }])
  })
})

describe('ProcessLogSheet', () => {
  it('renders nothing while no process is selected', async () => {
    await mount(<ProcessLogSheet data={dataOf({ shells: [shell()] })} />)
    expect(document.body.textContent).not.toContain('It has printed nothing yet.')
  })

  it('shows the selected log with a Kill action and closes by deselecting', async () => {
    const killed: string[] = []
    const chosen: Array<ProcessRef | null> = []
    await mount(
      <ProcessLogSheet
        data={dataOf({
          shells: [shell()],
          selected: { kind: EProcessKind.Shell, id: 'shell_1' },
          log: 'compiled ok',
          handleKill: async (id) => {
            killed.push(id)
          },
          handleSelect: (ref) => chosen.push(ref),
        })}
      />,
    )
    expect(document.body.textContent).toContain('Dev server')
    expect(document.body.textContent).toContain('compiled ok')
    const kill = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Kill')
    await click(kill)
    expect(killed).toEqual(['shell_1'])
    await click(document.querySelector('[data-slot="sheet-close"]'))
    expect(chosen).toEqual([null])
  })

  it('offers Stop for a running service and the empty-output line', async () => {
    await mount(
      <ProcessLogSheet
        data={dataOf({
          services: [service()],
          selected: { kind: EProcessKind.Service, id: 'svc_once' },
          log: '',
        })}
      />,
    )
    expect(document.body.textContent).toContain('It has printed nothing yet.')
    expect([...document.querySelectorAll('button')].some((b) => b.textContent === 'Stop')).toBe(
      true,
    )
  })
})
