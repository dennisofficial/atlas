import { EServiceStatus, EShellStatus, EStopAction, toThreadId } from '@dltech/atlas-core'
import { toShellId, type ServiceSnapshot, type ShellSnapshot } from '@dltech/atlas-harness'

import type { ServeProcesses } from '../process-requests'

export const threadId = toThreadId('thread-processes')

export const SHELL: ShellSnapshot = {
  shellId: toShellId('shell-1'),
  threadId,
  command: 'bun run dev',
  description: 'dev server',
  status: EShellStatus.Running,
  startedAt: '2026-10-28T10:00:00.000Z',
  lastOutputAt: '2026-10-28T10:00:01.000Z',
  totalCharacters: 12,
  awaitingInput: false,
}

export const SERVICE: ServiceSnapshot = {
  serviceId: 'svc-1',
  command: 'bun run preview',
  description: 'preview server',
  status: EServiceStatus.Running,
  logPath: '/nowhere/svc-1.log',
  startedAt: '2026-10-28T10:00:00.000Z',
}

export const fakeProcesses = (overrides: {
  shells?: Partial<ServeProcesses['shells']>
  services?: Partial<ServeProcesses['services']>
}): ServeProcesses => ({
  shells: {
    start: async () => ({ ok: true, snapshot: SHELL }),
    peek: async () => 'tail',
    kill: () => ({ ok: true, snapshot: SHELL }),
    ...overrides.shells,
  },
  services: {
    list: () => [SERVICE],
    stop: () => ({ ok: true, snapshot: SERVICE, action: EStopAction.Term }),
    ...overrides.services,
  },
  cwd: '/workspace',
})
