import { describe, expect, it } from 'bun:test'

import { createServeLauncher } from '../sandbox-serve-launch.js'
import {
  SANDBOX_WORKSPACE_PATH,
  SERVE_BINARY_PATH,
  SERVE_HOME,
  SERVE_LOCK_PATH,
  SERVE_LOG_PATH,
  SERVE_TOKEN_PATH,
} from '../serve-env.js'
import { fakeSandbox, launchesOf, scriptsOf } from './sandbox-serve-launch-fixture.js'

describe('createServeLauncher boot', () => {
  it('boots a serve only when none is alive, under the flock, with the pid recorded', async () => {
    const { sandbox, commands } = fakeSandbox({ healthy: false, alive: false })

    await createServeLauncher()({ sandbox })

    const launches = launchesOf(commands)
    expect(launches).toHaveLength(1)
    const launch = scriptsOf(launches)[0] ?? ''
    expect(launch).toContain(`echo $$ > ${SERVE_HOME}/atlas-serve.pid`)
    expect(launch).toContain(SERVE_LOCK_PATH)
    expect(launch).toContain(SERVE_BINARY_PATH)
    expect(launch).toContain(SERVE_LOG_PATH)
  })

  it('starts serve inside the sandbox workspace, never the provider default cwd', async () => {
    const { sandbox, commands } = fakeSandbox({ healthy: false, alive: false })

    await createServeLauncher()({ sandbox })

    const launch = scriptsOf(launchesOf(commands))[0] ?? ''
    const changeDirectory = `mkdir -p ${SANDBOX_WORKSPACE_PATH} && cd ${SANDBOX_WORKSPACE_PATH} && `
    expect(launch).toContain(changeDirectory)
    expect(launch.indexOf(changeDirectory)).toBeLessThan(launch.indexOf('exec flock'))
  })

  it('appends serve diagnostics under the sandbox home after creating their directory privately', async () => {
    const { sandbox, commands } = fakeSandbox({ healthy: false, alive: false })

    await createServeLauncher()({ sandbox })

    const launch = scriptsOf(launchesOf(commands))[0] ?? ''
    expect(SERVE_LOG_PATH).toBe('/atlas/home/operational/atlas-serve.log')
    expect(launch).toContain('umask 077')
    expect(launch).toContain('mkdir -p /atlas/home/operational')
    expect(launch.indexOf('mkdir -p')).toBeLessThan(launch.indexOf(`>> ${SERVE_LOG_PATH}`))
    expect(launch).toContain(`>> ${SERVE_LOG_PATH} 2>&1`)
    expect(SERVE_TOKEN_PATH).toBe('/opt/atlas/atlas-serve.token')
  })

  it('hands the sandbox session id and cloud url to the detached boot, not to process env', async () => {
    const { sandbox, commands } = fakeSandbox({
      healthy: false,
      alive: false,
      lazyResume: { staleSessionId: 'vsn_42', resumedSessionId: 'vsn_42' },
    })

    await createServeLauncher()({ sandbox, cloudUrl: 'https://api.example.com' })

    const launch = launchesOf(commands)[0]
    expect(launch?.env).toEqual({
      ATLAS_SANDBOX_SESSION_ID: 'vsn_42',
      ATLAS_CLOUD_URL: 'https://api.example.com',
    })
  })

  it('boots serve under the session a lazy resume swapped in, not the stopped one it was handed', async () => {
    const { sandbox, commands } = fakeSandbox({
      healthy: false,
      alive: false,
      lazyResume: { staleSessionId: 'sbx_parked', resumedSessionId: 'sbx_resumed' },
    })

    await createServeLauncher()({ sandbox })

    expect(launchesOf(commands)[0]?.env).toEqual({ ATLAS_SANDBOX_SESSION_ID: 'sbx_resumed' })
  })

  it('boots with an empty env when no session identity is readable', async () => {
    const { sandbox, commands } = fakeSandbox({ healthy: false, alive: false })

    await createServeLauncher()({ sandbox })

    expect(launchesOf(commands)[0]?.env).toEqual({})
  })

  it('includes the serve log tail when a fresh boot never answers', async () => {
    const { sandbox } = fakeSandbox({
      healthy: false,
      alive: false,
      waitSucceeds: false,
      logTail: 'panic: cannot open store',
    })

    await expect(createServeLauncher()({ sandbox })).rejects.toThrow('panic: cannot open store')
  })

  it('logs each launcher decision for operational attribution', async () => {
    const kept = fakeSandbox({ healthy: true })
    const keptLines: string[] = []
    await createServeLauncher({ log: (line) => keptLines.push(line) })({ sandbox: kept.sandbox })
    expect(keptLines.some((line) => line.includes('keeping it'))).toBe(true)

    const booted = fakeSandbox({ healthy: false, alive: false })
    const bootLines: string[] = []
    await createServeLauncher({ log: (line) => bootLines.push(line) })({
      sandbox: booted.sandbox,
    })
    expect(bootLines.some((line) => line.includes('booting it under the flock'))).toBe(true)
    expect(bootLines.some((line) => line.includes('answers /v1/health'))).toBe(true)
  })

  it('issues at most three remote commands before launching on a fresh sandbox', async () => {
    const { sandbox, commands } = fakeSandbox({ healthy: false, alive: false })

    await createServeLauncher()({ sandbox, token: 'tok_fresh' })

    const launchAt = commands.findIndex((command) => command.detached === true)
    expect(launchAt).toBeGreaterThan(-1)
    expect(launchAt).toBeLessThanOrEqual(3)
  })

  it('polls health every 250ms for 10s, then every second, within the old budget', async () => {
    const { sandbox, commands } = fakeSandbox({ healthy: false, alive: false })

    await createServeLauncher()({ sandbox })

    const wait = scriptsOf(commands).find((script) => script.startsWith('for i in')) ?? ''
    expect(wait).toContain('seq 40')
    expect(wait).toContain('sleep 0.25')
    expect(wait).toContain('seq 170')
    expect(wait).toContain('sleep 1;')
  })
})
