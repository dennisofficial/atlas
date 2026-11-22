import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { DaemonHandle, DaemonSession } from '@dltech/atlas-protocol/testing'
import { DAEMON_MEMORY_RESERVE, memoryMaxFor } from '@dltech/atlas-sandbox'

import { realDaemonTarget } from '../testing'

export const oomTarget = realDaemonTarget({
  name: 'oom',
  entry: join(import.meta.dir, '../index.ts'),
  workloads: true,
})

export const openSession = async (handle: DaemonHandle): Promise<DaemonSession> => {
  const session = await handle.connect()
  session.send({ kind: 'hello', sessionId: 'oom', epoch: 1, token: handle.token })
  await session.until((frame) => frame.kind === 'health')
  return session
}

export const memTotalBytes = (): number => {
  const match = /^MemTotal:\s+(\d+)\s+kB/m.exec(readFileSync('/proc/meminfo', 'utf8'))
  if (match?.[1] === undefined) throw new Error('no MemTotal in meminfo')
  return Number(match[1]) * 1024
}

export const commandLimitBytes = (): number =>
  memoryMaxFor({ meminfo: readFileSync('/proc/meminfo', 'utf8'), reserve: DAEMON_MEMORY_RESERVE })

export const expectedMemory = (): { commandLimitBytes: number; podBytes: number } => ({
  commandLimitBytes: commandLimitBytes(),
  podBytes: memTotalBytes(),
})

export const writeOomEvents = (kills: number): string =>
  `printf 'oom 1\\noom_kill ${kills}\\n' > "$ATLAS_WORKLOAD_CGROUP/w-$$/memory.events"`
