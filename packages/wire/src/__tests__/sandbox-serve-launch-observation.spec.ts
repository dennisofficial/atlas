import { describe, expect, it } from 'bun:test'

import { createServeLauncher, parseServeObservation } from '../sandbox-serve-launch.js'
import { SERVE_TOKEN_PATH } from '../serve-env.js'
import { fakeSandbox, launchesOf, scriptsOf } from './sandbox-serve-launch-fixture.js'

describe('createServeLauncher observation', () => {
  it('keeps a healthy serve whose stamps match the pin, whatever its health body reports', async () => {
    const { sandbox, commands } = fakeSandbox({
      healthy: true,
      alive: true,
      serveVersion: '1.89.1',
      healthBody:
        '{"ok":true,"sandboxSessionId":"vsn_42","busy":false,"turnRunning":false,"childrenRunning":0,"shellsRunning":0,"servicesRunning":0,"pendingInput":false,"settlingWork":false,"clients":1}',
    })

    await createServeLauncher()({ sandbox, token: 'tok_fresh', desiredVersion: '1.89.1' })

    expect(scriptsOf(commands).some((script) => script.includes('kill "$_pid"'))).toBe(false)
    expect(launchesOf(commands)).toHaveLength(0)
  })

  it('keeps a live healthy serve even when its health body cannot be parsed', async () => {
    const { sandbox, commands } = fakeSandbox({
      healthy: true,
      alive: true,
      serveVersion: '1.89.1',
      healthBody: 'not-json',
    })

    await createServeLauncher()({ sandbox, token: 'tok_fresh', desiredVersion: '1.89.1' })

    expect(scriptsOf(commands).some((script) => script.includes('kill "$_pid"'))).toBe(false)
    expect(launchesOf(commands)).toHaveLength(0)
  })

  it('swaps a drifted serve in place and boots the replacement', async () => {
    const { sandbox, commands } = fakeSandbox({
      healthy: false,
      alive: true,
      serveVersion: '1.88.0',
      lazyResume: { staleSessionId: 'sbx_parked', resumedSessionId: 'sbx_resumed' },
    })

    await createServeLauncher({ installServe: async () => undefined })({
      sandbox,
      token: 'tok_fresh',
      desiredVersion: '1.89.1',
    })

    expect(scriptsOf(commands).some((script) => script.includes('kill "$_pid"'))).toBe(true)
    expect(launchesOf(commands)).toHaveLength(1)
    expect(launchesOf(commands)[0]?.env).toEqual({ ATLAS_SANDBOX_SESSION_ID: 'sbx_resumed' })
  })

  it('still validates the token against a live process in the single observation', async () => {
    const { sandbox, commands } = fakeSandbox({ healthy: true, alive: true })

    await createServeLauncher()({ sandbox, token: 'tok_live' })

    const observation = commands[0]
    expect(observation?.env).toEqual({ ATLAS_SERVE_TOKEN: 'tok_live' })
    expect(observation?.args?.[1]).toContain(`cat ${SERVE_TOKEN_PATH}`)
    expect(commands).toHaveLength(1)
  })

  it('parses a missing or garbled observation like failed probes: alive, absent, unhealthy, token mismatched, unstamped', () => {
    expect(parseServeObservation('')).toMatchObject({
      alive: true,
      present: false,
      healthy: false,
      tokenMatches: false,
      stamps: { version: undefined, protocol: 0 },
    })
  })

  it('treats each absent field as its failed probe, not as success', () => {
    const complete = ['alive=0', 'present=1', 'version=', 'protocol=', 'token=1', 'healthy=1']
    const without = (field: string): string =>
      complete.filter((line) => !line.startsWith(`${field}=`)).join('\n')
    expect(parseServeObservation(without('alive')).alive).toBe(true)
    expect(parseServeObservation(without('token')).tokenMatches).toBe(false)
    expect(parseServeObservation(without('healthy')).healthy).toBe(false)
    expect(parseServeObservation(without('present')).present).toBe(false)
  })

  it('refuses as a token mismatch when the observation lacks the token field', async () => {
    const { sandbox, commands } = fakeSandbox({ healthy: true, alive: true })
    const run = sandbox.runCommand.bind(sandbox)
    sandbox.runCommand = (async (params: Parameters<typeof run>[0]) => {
      const result = await run(params)
      if (!(params.args?.[1] ?? '').includes('alive=1') || !('stdout' in result)) return result
      const stdout = await result.stdout()
      return { ...result, stdout: async () => stdout.replace(/token=\d\n?/, '') }
    }) as typeof sandbox.runCommand

    await expect(createServeLauncher()({ sandbox, token: 'tok_x' })).rejects.toThrow(
      'under a different token',
    )
    expect(launchesOf(commands)).toHaveLength(0)
  })

  it('treats a failed observation command like failed probes, ignoring its stdout', async () => {
    const { sandbox, commands } = fakeSandbox({ healthy: true, alive: true })
    const run = sandbox.runCommand.bind(sandbox)
    sandbox.runCommand = (async (params: Parameters<typeof run>[0]) => {
      const result = await run(params)
      return (params.args?.[1] ?? '').includes('alive=1') ? { ...result, exitCode: 1 } : result
    }) as typeof sandbox.runCommand

    await expect(createServeLauncher()({ sandbox, token: 'tok_x' })).rejects.toThrow(
      'under a different token',
    )
    expect(launchesOf(commands)).toHaveLength(0)
  })
})
