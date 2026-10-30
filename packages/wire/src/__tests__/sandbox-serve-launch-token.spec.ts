import { describe, expect, it } from 'bun:test'

import { createServeLauncher, HEALTH_PROBE } from '../sandbox-serve-launch.js'
import { SERVE_TOKEN_PATH } from '../serve-env.js'
import { fakeSandbox, launchesOf, scriptsOf } from './sandbox-serve-launch-fixture.js'

describe('createServeLauncher token and health', () => {
  it('writes the session token before the boot probes', async () => {
    const { sandbox, writes, ops } = fakeSandbox({ healthy: true, alive: false })

    await createServeLauncher()({ sandbox, token: 'tok_fresh' })

    expect(writes).toEqual([{ path: SERVE_TOKEN_PATH, content: 'tok_fresh', mode: 0o600 }])
    const writeAt = ops.indexOf('write')
    expect(writeAt).toBeGreaterThan(-1)
    expect(ops.slice(0, writeAt).every((op) => op === 'command')).toBe(true)
  })

  it('leaves the sandbox filesystem alone when no token is given', async () => {
    const { sandbox, writes } = fakeSandbox({ healthy: true })

    await createServeLauncher()({ sandbox })

    expect(writes).toHaveLength(0)
  })

  it('never writes the token while a serve process is alive, even when health fails', async () => {
    const { sandbox, writes } = fakeSandbox({ healthy: false, alive: true })

    await createServeLauncher()({ sandbox, token: 'tok_fresh' })

    expect(writes).toHaveLength(0)
  })

  it('refuses a token that disagrees with a live serve rather than rotating it under it', async () => {
    const { sandbox, commands, writes } = fakeSandbox({
      healthy: true,
      alive: true,
      tokenMatches: false,
    })

    await expect(createServeLauncher()({ sandbox, token: 'tok_stranger' })).rejects.toThrow(
      'under a different token',
    )

    expect(writes).toHaveLength(0)
    expect(launchesOf(commands)).toHaveLength(0)
  })

  it('authenticates the health probe with the token file, falling back to the launch environment', async () => {
    const { sandbox } = fakeSandbox({ healthy: true })

    await createServeLauncher()({ sandbox })

    expect(HEALTH_PROBE).toContain(`_serve_token=$(cat ${SERVE_TOKEN_PATH} 2>/dev/null || true)`)
    expect(HEALTH_PROBE).toContain(
      '[ -n "$_serve_token" ] && export ATLAS_SERVE_TOKEN="$_serve_token"',
    )
    expect(HEALTH_PROBE).toContain('Authorization: Bearer $ATLAS_SERVE_TOKEN')
  })

  it('does nothing when serve is already healthy', async () => {
    const { sandbox, commands } = fakeSandbox({ healthy: true })

    await createServeLauncher()({ sandbox })

    expect(launchesOf(commands)).toHaveLength(0)
    expect(scriptsOf(commands).some((script) => script.startsWith('for pid in'))).toBe(false)
  })

  it('never kills processes — a wedged serve is preserved and waited on, not relaunched', async () => {
    const { sandbox, commands } = fakeSandbox({ healthy: false, alive: true })
    const lines: string[] = []

    await createServeLauncher({ log: (line) => lines.push(line) })({ sandbox })

    const scripts = scriptsOf(commands)
    expect(scripts.some((script) => script.includes('kill "$'))).toBe(false)
    expect(scripts.some((script) => script.startsWith('for pid in'))).toBe(false)
    expect(launchesOf(commands)).toHaveLength(0)
    expect(scripts.some((script) => script.startsWith('for i in'))).toBe(true)
    expect(lines.some((line) => line.includes('preserved'))).toBe(true)
  })

  it('fails loudly with the log tail when a live serve never answers, without touching the process', async () => {
    const { sandbox, commands } = fakeSandbox({
      healthy: false,
      alive: true,
      waitSucceeds: false,
      logTail: 'Error: EADDRINUSE: address already in use',
    })

    await expect(createServeLauncher()({ sandbox })).rejects.toThrow(
      'EADDRINUSE: address already in use',
    )
    await expect(createServeLauncher()({ sandbox })).rejects.toThrow('preserved rather than killed')
    expect(launchesOf(commands)).toHaveLength(0)
  })

  it('degrades to a marker when the serve log cannot be read', async () => {
    const { sandbox } = fakeSandbox({ healthy: false, alive: true, waitSucceeds: false })

    await expect(createServeLauncher()({ sandbox })).rejects.toThrow(
      '<serve log is empty or missing>',
    )
  })
})
