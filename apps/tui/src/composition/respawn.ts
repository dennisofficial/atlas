import { existsSync, renameSync } from 'node:fs'

import { EBuildKind } from '../build/info'
import { nextBinaryPathFor } from '../build/self-update-asset'

export function wiresSelfRestart(kind: EBuildKind): boolean {
  return kind !== EBuildKind.Source
}

export function respawnArgv(args: {
  execPath: string
  cwd: string
  resumeHandle: string | null
}): readonly string[] {
  return [
    args.execPath,
    '--cwd',
    args.cwd,
    ...(args.resumeHandle === null ? [] : ['--resume', args.resumeHandle]),
  ]
}

export type RespawnPorts = {
  readonly nextBinaryExists: () => boolean
  readonly promoteNextBinary: () => void
  readonly spawnDetached: (argv: readonly string[]) => void
  readonly reportPromotionFailure: (error: unknown) => void
  readonly exit: (code: number) => void
}

export function performRespawn(args: {
  execPath: string
  cwd: string
  resumeHandle: string | null
  ports: RespawnPorts
}): void {
  if (args.ports.nextBinaryExists()) {
    try {
      args.ports.promoteNextBinary()
    } catch (error) {
      args.ports.reportPromotionFailure(error)
    }
  }

  args.ports.spawnDetached(
    respawnArgv({ execPath: args.execPath, cwd: args.cwd, resumeHandle: args.resumeHandle }),
  )
  args.ports.exit(0)
}

export function realRespawnPorts(execPath: string): RespawnPorts {
  const nextPath = nextBinaryPathFor(execPath)

  return {
    nextBinaryExists: () => existsSync(nextPath),
    promoteNextBinary: () => renameSync(nextPath, execPath),
    spawnDetached: (argv) => {
      Bun.spawn([...argv], { stdio: ['inherit', 'inherit', 'inherit'], detached: true }).unref()
    },
    reportPromotionFailure: (error) => {
      process.stderr.write(`atlas: could not promote the staged update: ${String(error)}\n`)
    },
    exit: (code) => process.exit(code),
  }
}
