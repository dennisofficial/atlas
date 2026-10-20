import { describe, expect, it } from 'bun:test'

import { EShellStatus, toThreadId, type EventLogPort, type IdPort, type NoticePort } from '@dltech/atlas-core'

import type { AgentRegistryPort } from '../../agents/registry/port'
import { createIsolatedContainer } from '../../container/injection'
import { createPendingQueues } from '../../pending'
import type { ServiceRegistryPort } from '../../services/service-registry'
import type { ShellRegistryPort } from '../../shells/shell-registry'
import type { AccountUsageService } from '../../usage/account-usage-service'
import { closeSession } from '../compose-lifecycle'
import { bindIntake } from '../intake-binding'

const THREAD = toThreadId('thread-under-test')

const running = { shellId: 'bash_1', threadId: THREAD, status: EShellStatus.Running }

const fakes = (args: { shells: readonly unknown[] }) => {
  const calls: string[] = []
  let killed = false
  const shells = {
    listEverywhere: () => (killed ? [] : args.shells),
    onNotice: () => () => undefined,
    pendingNotices: () => [],
    threadsAwaitingNotice: () => [],
    threadsWithPendingInput: () => [],
    drainNotifications: () => [],
    detachAll: async () => void calls.push('shells:detach'),
    closeAll: async () => {
      killed = true
      calls.push('shells:kill')
    },
  } as unknown as ShellRegistryPort
  const agents = {
    listEverywhere: () => [],
    onChange: () => () => undefined,
    onNotice: () => () => undefined,
    pendingNotices: () => [],
    threadsAwaitingNotice: () => [],
    drainNotifications: () => ({ drafts: [] }),
    closeAll: async () => void calls.push('agents:close'),
  } as unknown as AgentRegistryPort
  const services = {
    list: () => [],
    onNotice: () => () => undefined,
    threadsAwaitingNotice: () => [],
    drainNotifications: () => [],
    closeAll: async () => void calls.push('services:close'),
  } as unknown as ServiceRegistryPort
  const bound = bindIntake({
    pending: createPendingQueues<never>(),
    shells,
    agents,
    services,
    log: {} as unknown as EventLogPort,
    ids: {} as unknown as IdPort,
  })
  return { calls, shells, bound }
}

const closeWith = async (args: { shells: readonly unknown[]; stopShells: boolean }) => {
  const made = fakes({ shells: args.shells })
  const notices: string[] = []
  await closeSession({
    container: createIsolatedContainer(),
    notice: { notify: (post: { text: string }) => void notices.push(post.text) } as unknown as NoticePort,
    usage: { dispose: () => undefined } as unknown as AccountUsageService,
    recordTeardownEndings: made.bound.recordTeardownEndings,
    request: { stopShells: args.stopShells },
    stopShells: async () => {
      made.bound.intake.suspend()
      await made.shells.closeAll()
    },
  }).catch(() => undefined)
  return made.calls
}

describe('closing a session', () => {
  it('detaches running shells without killing them', async () => {
    const calls = await closeWith({ shells: [running], stopShells: false })

    expect(calls).toContain('shells:detach')
    expect(calls).not.toContain('shells:kill')
  })

  it('still stops agents and services when shells are kept', async () => {
    const calls = await closeWith({ shells: [running], stopShells: false })

    expect(calls).toContain('agents:close')
    expect(calls).toContain('services:close')
  })

  it('kills shells before anything is detached when the close asks to stop them', async () => {
    const calls = await closeWith({ shells: [running], stopShells: true })

    expect(calls[0]).toBe('shells:kill')
  })
})
