import { EKilledBy, EServiceStatus, toThreadId } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import type { ThreadStorePort } from '../../../store/thread-store'

import { EShellStatus, type ShellSnapshot } from '../../../shells/background-shell'
import { toShellId } from '../../../shells/shell-id'
import type { ServiceSnapshot } from '../../../services/service-process'
import { fakeShellRegistry } from './fake-shells'
import { fakeServiceRegistry } from './fake-services'
import { stopLocalWork } from '../stop-local'

const THREAD = toThreadId('lifted-thread')
const OTHER_THREAD = toThreadId('stays-local')

const CHILD = toThreadId('subagent')
const GRANDCHILD = toThreadId('teammate')

const familyTree = (tree: Record<string, readonly string[]> = {}): Pick<ThreadStorePort, 'spawned'> => ({
  spawned: async ({ threadId }) =>
    (tree[threadId] ?? []).map((id) => ({ id: toThreadId(id) }) as never),
})

const AT = '2026-09-22T12:00:00.000Z'

const runningShell = (over: Partial<ShellSnapshot> = {}): ShellSnapshot =>
  ({
    shellId: toShellId('bash_1'),
    command: 'bun run dev',
    description: 'dev server',
    status: EShellStatus.Running,
    pid: 4_242,
    startedAt: AT,
    lastOutputAt: AT,
    totalCharacters: 18,
    awaitingInput: false,
    ...over,
  }) as ShellSnapshot

const endedShell = (over: Partial<ShellSnapshot> = {}): ShellSnapshot =>
  ({
    ...runningShell({ shellId: toShellId('bash_2'), command: 'bun test' }),
    status: EShellStatus.Exited,
    exitCode: 0,
    ...over,
  }) as ShellSnapshot

const runningService = (over: Partial<ServiceSnapshot> = {}): ServiceSnapshot => ({
  serviceId: 'svc_1',
  command: 'bun run api',
  description: 'api',
  status: EServiceStatus.Running,
  logPath: '/tmp/svc_1.log',
  startedAt: AT,
  ...over,
})

const endedService = (over: Partial<ServiceSnapshot> = {}): ServiceSnapshot => ({
  ...runningService({ serviceId: 'svc_2', command: 'bun run worker', description: 'worker' }),
  status: EServiceStatus.Exited,
  exitCode: 0,
  ...over,
})

describe('stopping local work for a lift', () => {
  it('kills the thread’s shells and stops every service, narrating them by label', async () => {
    const shells = fakeShellRegistry()
    const services = fakeServiceRegistry()
    shells.place(runningShell(), THREAD)
    services.place(runningService(), THREAD)

    const stopped = await stopLocalWork({ threadId: THREAD, shells, services, threads: familyTree() })

    expect(shells.killed).toEqual(['bash_1'])
    expect(services.stopped).toEqual([{ serviceId: 'svc_1', by: EKilledBy.ContainerSwitch }])
    expect(stopped.shells).toEqual(['dev server'])
    expect(stopped.services).toEqual(['api'])
  })

  it('hands the queued ending notices to the lift once, leaving nothing behind to wake a turn', async () => {
    const shells = fakeShellRegistry()
    const services = fakeServiceRegistry()
    shells.announce(endedShell(), THREAD)
    services.announce(endedService(), THREAD)

    const stopped = await stopLocalWork({ threadId: THREAD, shells, services, threads: familyTree() })

    expect(stopped.drainNotices().map((draft) => draft.type)).toEqual([
      'background-shell-ended',
      'service-ended',
    ])
    expect(stopped.drainNotices()).toEqual([])
    expect(shells.pendingNotices({ threadId: THREAD })).toEqual([])
    expect(services.pendingNotices({ threadId: THREAD })).toEqual([])
  })

  it('leaves another thread’s queued notices alone', async () => {
    const shells = fakeShellRegistry()
    const services = fakeServiceRegistry()
    shells.announce(endedShell(), OTHER_THREAD)

    const stopped = await stopLocalWork({ threadId: THREAD, shells, services, threads: familyTree() })

    expect(stopped.drainNotices()).toEqual([])
    expect(shells.pendingNotices({ threadId: OTHER_THREAD })).toHaveLength(1)
  })

  it('kills the running shells of subagents and teammates below the root, not only the root’s', async () => {
    const shells = fakeShellRegistry()
    const services = fakeServiceRegistry()
    shells.place(runningShell(), THREAD)
    shells.place(runningShell({ shellId: toShellId('bash_child'), description: 'child watcher' }), CHILD)
    shells.place(runningShell({ shellId: toShellId('bash_deep'), description: 'deep build' }), GRANDCHILD)
    shells.place(runningShell({ shellId: toShellId('bash_other') }), OTHER_THREAD)

    const stopped = await stopLocalWork({
      threadId: THREAD,
      shells,
      services,
      threads: familyTree({ [THREAD]: [CHILD], [CHILD]: [GRANDCHILD] }),
    })

    expect([...shells.killed].sort()).toEqual(['bash_1', 'bash_child', 'bash_deep'])
    expect(stopped.shells).toEqual(['dev server', 'child watcher', 'deep build'])
  })

  it('drains the family’s queued endings, so a child’s ending cannot leak into a later turn', async () => {
    const shells = fakeShellRegistry()
    const services = fakeServiceRegistry()
    shells.announce(endedShell(), CHILD)

    const stopped = await stopLocalWork({
      threadId: THREAD,
      shells,
      services,
      threads: familyTree({ [THREAD]: [CHILD] }),
    })

    expect(stopped.drainNotices().map((draft) => draft.type)).toEqual(['background-shell-ended'])
  })

  it('refuses the move when a shell is still unsettled after the kill', async () => {
    const shells = fakeShellRegistry()
    const services = fakeServiceRegistry()
    shells.place(runningShell(), CHILD)
    const stubborn = Object.assign(Object.create(shells), {
      awaitEndings: async () => 1,
    }) as typeof shells

    await expect(
      stopLocalWork({
        threadId: THREAD,
        shells: stubborn,
        services,
        threads: familyTree({ [THREAD]: [CHILD] }),
      }),
    ).rejects.toThrow('have not stopped')
  })
})
