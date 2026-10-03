import type { IdPort } from '@dltech/atlas-core'
import {
  BunShellRegistry,
  DurableShellLauncher,
  HookChain,
  JsonlEventLog,
  LocalProcessPort,
  prepareSupervisorLauncher,
  RandomIds,
  registryFor,
  ShellStorage,
  SystemClock,
  type ThreadStorePort,
} from '@dltech/atlas-harness'

import { SessionEnvironmentProcessPort } from '../../../packages/harness/src/execution/session-environment'
import { JsonlThreadStore } from '../../../packages/harness/src/store/sessions/thread-store'

export type BenchShells = {
  registry: BunShellRegistry
  threads: ThreadStorePort
}

export const benchShellRegistry = async ({ root }: { root: string }): Promise<BenchShells> => {
  const clock = new SystemClock()
  const ids: IdPort = new RandomIds()
  const sessions = registryFor({ home: root })
  const log = new JsonlEventLog(root, sessions, clock, ids)
  const threads = new JsonlThreadStore(root, sessions, clock, ids, log)
  const processes = new SessionEnvironmentProcessPort({ inner: new LocalProcessPort(), sessions })
  const launcher = new DurableShellLauncher({
    storage: new ShellStorage({ sessions }),
    sessions,
    processes,
    supervisor: () => prepareSupervisorLauncher({ home: root }),
    now: () => clock.now(),
  })
  const registry = new BunShellRegistry({
    root,
    clock,
    hooks: () => new HookChain({}),
    launcher,
    log,
    ids,
  })
  return { registry, threads }
}
