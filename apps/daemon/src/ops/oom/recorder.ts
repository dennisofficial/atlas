import { basename } from 'node:path'

import { EOomScope, type OomMemory } from '@dltech/atlas-core'
import type { DaemonEvent } from '@dltech/atlas-protocol'

import { boxOomKillCount } from '../../process/managed'
import type { DaemonOpsDeps } from '../deps'
import { OomJournal } from './journal'
import { commandLimitBytesOf, oomMemoryOf } from './memory'
import {
  POD_OOM_GRACE_MS,
  POD_OOM_INTERVAL_MS,
  type PodOomWatcher,
  podOomWatcherOf,
} from './watcher'

type Env = Record<string, string | undefined>

const SCRIPT_SHELLS = new Set(['bash', 'dash', 'ksh', 'sh', 'zsh'])

export type OomRecorder = {
  journal: OomJournal
  command(args: {
    pid: number
    command: string
    publish: (event: DaemonEvent) => void
  }): OomMemory | null
  commandRamLimitBytes(): number | null
  watchPod(publish: (event: DaemonEvent) => void): void
  stop(): void
}

export const commandNameOf = (argv: readonly string[]): string => {
  const [executable, flag, script] = argv
  const shell = executable === undefined ? '' : basename(executable)
  if (SCRIPT_SHELLS.has(shell) && flag === '-c' && script !== undefined && script.trim() !== '') {
    return script
  }
  const joined = argv.join(' ').trim()
  return joined === '' ? 'command' : joined
}

export const createOomRecorder = (args: {
  env: Env
  home: string
  intervalMs?: number | undefined
  graceMs?: number | undefined
}): OomRecorder => {
  const journal = new OomJournal(args.home)
  let watcher: PodOomWatcher | null = null

  const command: OomRecorder['command'] = (request) => {
    const processes = boxOomKillCount({ pid: request.pid, env: args.env })
    if (processes < 1) return null
    const memory = oomMemoryOf(args.env)
    if (memory === null) return null
    watcher?.claim(processes)
    const incident = journal.record({
      scope: EOomScope.Command,
      command: request.command,
      processes,
      memory,
    })
    request.publish({ type: 'pod.oom', incident })
    return memory
  }

  const watchPod: OomRecorder['watchPod'] = (publish) => {
    if (watcher !== null) return
    watcher = podOomWatcherOf({
      env: args.env,
      journal,
      publish,
      intervalMs: args.intervalMs ?? POD_OOM_INTERVAL_MS,
      graceMs: args.graceMs ?? POD_OOM_GRACE_MS,
    })
    watcher.start()
  }

  return {
    journal,
    command,
    commandRamLimitBytes: () => commandLimitBytesOf(args.env),
    watchPod,
    stop: () => watcher?.stop(),
  }
}

const recorders = new WeakMap<DaemonOpsDeps, OomRecorder>()

export const oomRecorderOf = (deps: DaemonOpsDeps): OomRecorder => {
  const existing = recorders.get(deps)
  if (existing !== undefined) return existing
  const created = createOomRecorder({ env: deps.env, home: deps.home })
  recorders.set(deps, created)
  return created
}
