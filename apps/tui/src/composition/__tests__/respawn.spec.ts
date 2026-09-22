import { describe, expect, it } from 'bun:test'

import { EBuildKind } from '../../build/info'
import { performRespawn, respawnArgv, wiresSelfRestart, type RespawnPorts } from '../respawn'

describe('wiresSelfRestart', () => {
  it('wires its own restart for a compiled release binary', () => {
    expect(wiresSelfRestart(EBuildKind.Release)).toBe(true)
  })

  it('wires its own restart for a compiled dev binary', () => {
    expect(wiresSelfRestart(EBuildKind.Dev)).toBe(true)
  })

  it('stays out of a source launch, where the exec path is bun itself', () => {
    expect(wiresSelfRestart(EBuildKind.Source)).toBe(false)
  })
})

describe('respawnArgv', () => {
  it('carries the exec path and cwd with no resume handle', () => {
    expect(respawnArgv({ execPath: '/opt/atlas/atlas', cwd: '/repo', resumeHandle: null })).toEqual(
      ['/opt/atlas/atlas', '--cwd', '/repo'],
    )
  })

  it('appends a single --resume when a handle was carried across the restart', () => {
    expect(
      respawnArgv({ execPath: '/opt/atlas/atlas', cwd: '/repo', resumeHandle: 'daily-driver' }),
    ).toEqual(['/opt/atlas/atlas', '--cwd', '/repo', '--resume', 'daily-driver'])
  })

  it('builds argv fresh each time, so a handle from one call never leaks into the next', () => {
    respawnArgv({ execPath: '/opt/atlas/atlas', cwd: '/repo', resumeHandle: 'stale-handle' })
    const argv = respawnArgv({ execPath: '/opt/atlas/atlas', cwd: '/repo', resumeHandle: null })

    expect(argv.filter((token) => token === '--resume')).toHaveLength(0)
  })

  it('never emits more than one --resume flag', () => {
    const argv = respawnArgv({ execPath: '/opt/atlas/atlas', cwd: '/repo', resumeHandle: 'fresh-handle' })

    expect(argv.filter((token) => token === '--resume')).toHaveLength(1)
    expect(argv).toEqual(['/opt/atlas/atlas', '--cwd', '/repo', '--resume', 'fresh-handle'])
  })
})

function rig(args: { nextExists: boolean; promoteFails?: boolean }) {
  const calls = {
    promoted: 0,
    reported: [] as unknown[],
    spawned: [] as (readonly string[])[],
    exited: [] as number[],
  }

  const ports: RespawnPorts = {
    nextBinaryExists: () => args.nextExists,
    promoteNextBinary: () => {
      calls.promoted += 1
      if (args.promoteFails) throw new Error('rename refused')
    },
    reportPromotionFailure: (error) => {
      calls.reported.push(error)
    },
    spawnDetached: (argv) => {
      calls.spawned.push(argv)
    },
    exit: (code) => {
      calls.exited.push(code)
    },
  }

  return { ports, calls }
}

describe('performRespawn', () => {
  it('promotes a staged binary before spawning the replacement process', () => {
    const { ports, calls } = rig({ nextExists: true })

    performRespawn({ execPath: '/opt/atlas/atlas', cwd: '/repo', resumeHandle: null, ports })

    expect(calls.promoted).toBe(1)
    expect(calls.spawned).toEqual([['/opt/atlas/atlas', '--cwd', '/repo']])
    expect(calls.exited).toEqual([0])
  })

  it('respawns the running binary as-is when nothing was staged', () => {
    const { ports, calls } = rig({ nextExists: false })

    performRespawn({ execPath: '/opt/atlas/atlas', cwd: '/repo', resumeHandle: 'brn_1', ports })

    expect(calls.promoted).toBe(0)
    expect(calls.spawned).toEqual([['/opt/atlas/atlas', '--cwd', '/repo', '--resume', 'brn_1']])
  })

  it('reports a failed promotion and still respawns on the old binary', () => {
    const { ports, calls } = rig({ nextExists: true, promoteFails: true })

    performRespawn({ execPath: '/opt/atlas/atlas', cwd: '/repo', resumeHandle: null, ports })

    expect(calls.promoted).toBe(1)
    expect(calls.reported).toHaveLength(1)
    expect(calls.spawned).toEqual([['/opt/atlas/atlas', '--cwd', '/repo']])
    expect(calls.exited).toEqual([0])
  })
})
