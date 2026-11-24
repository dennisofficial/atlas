import { readFile } from 'node:fs/promises'

import { EServiceReapOutcome } from '@dltech/atlas-protocol'

const KILL_GRACE_MS = 2_000
const POLL_MS = 50

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM'
  }
}

const commandLineOf = async (pid: number): Promise<string | undefined> => {
  try {
    const text = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).replace(/\0/gu, ' ').trim()
    if (text !== '') return text
  } catch {
    // this host has no procfs
  }
  try {
    const listed = Bun.spawnSync({
      cmd: ['ps', '-o', 'command=', '-p', String(pid)],
      stdout: 'pipe',
      stderr: 'ignore',
    })
    const text = listed.stdout.toString().trim()
    return text === '' ? undefined : text
  } catch {
    return undefined
  }
}

const signalGroup = (args: { pid: number; signal: NodeJS.Signals }): void => {
  try {
    process.kill(-args.pid, args.signal)
  } catch {
    try {
      process.kill(args.pid, args.signal)
    } catch {
      return
    }
  }
}

const waitForDeath = async (args: { pid: number; timeoutMs: number }): Promise<boolean> => {
  const deadline = Date.now() + args.timeoutMs
  for (;;) {
    if (!isAlive(args.pid)) return true
    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
}

export const reapService = async (args: {
  pid: number
  command: string
  owned: boolean
}): Promise<EServiceReapOutcome> => {
  if (!isAlive(args.pid)) return EServiceReapOutcome.Absent
  const commandLine = await commandLineOf(args.pid)
  if (args.owned || commandLine === undefined || !commandLine.includes(args.command)) {
    return EServiceReapOutcome.Mismatch
  }
  signalGroup({ pid: args.pid, signal: 'SIGTERM' })
  if (await waitForDeath({ pid: args.pid, timeoutMs: KILL_GRACE_MS })) {
    return EServiceReapOutcome.Reaped
  }
  signalGroup({ pid: args.pid, signal: 'SIGKILL' })
  const dead = await waitForDeath({ pid: args.pid, timeoutMs: KILL_GRACE_MS })
  return dead ? EServiceReapOutcome.Reaped : EServiceReapOutcome.Mismatch
}
