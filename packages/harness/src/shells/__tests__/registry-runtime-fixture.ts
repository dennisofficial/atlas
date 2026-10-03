import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { LocalProcessPort } from '../../execution/local-process'
import { SessionEnvironmentProcessPort } from '../../execution/session-environment'
import { DurableShellLauncher } from '../durable-launcher'
import { defaultSupervisorCommand } from '../durable/client'
import type { ShellLauncherPort } from '../port'
import { toShellId } from '../shell-id'
import { ShellStorage } from '../storage'

export function registryRuntimeLauncher({ root }: { root: string }): ShellLauncherPort {
  const sessionDir = join(root, 'sessions', 'registry-test')
  mkdirSync(sessionDir, { recursive: true, mode: 0o700 })
  const sessions = { sessionDirOf: async () => sessionDir }
  const command = defaultSupervisorCommand()
  let sequence = 0
  return new DurableShellLauncher({
    storage: new ShellStorage({
      sessions,
      newId: () => toShellId(`shell_${++sequence}`),
    }),
    sessions,
    processes: new SessionEnvironmentProcessPort({ inner: new LocalProcessPort(), sessions }),
    supervisor: async () => ({ script: command[1] ?? '', host: command, docker: command }),
    now: () => new Date().toISOString(),
  })
}
