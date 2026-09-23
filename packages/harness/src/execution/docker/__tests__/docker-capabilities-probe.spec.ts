import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  EExecutionLocation,
  EPortExposure,
  toThreadId,
  type EnvironmentCapabilities,
} from '@dltech/atlas-core'

import { dockerCapabilitiesSource } from '../../../composition/capabilities-source'
import { createExecutionLocationState } from '../../../composition/execution-location-state'
import type { GitReader } from '../../../workspace/snapshot'
import { probeDockerCapabilities } from '../host-environment'

const reader = (answers: Record<string, string>): GitReader =>
  async ({ args }) => {
    const value = answers[args.join(' ')]
    if (value === undefined) return { ok: false, stdout: '', stderr: 'unset' }
    return { ok: true, stdout: `${value}\n`, stderr: '' }
  }

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

describe('probeDockerCapabilities', () => {
  let home: string
  let env: Record<string, string | undefined>
  let agent: ReturnType<typeof Bun.listen> | undefined

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'atlas-caps-'))
    env = { HOME: home, PATH: home }
  })

  afterEach(async () => {
    agent?.stop(true)
    agent = undefined
    await rm(home, { recursive: true, force: true })
  })

  const givenTokenAndSocket = async (): Promise<void> => {
    await writeFile(
      join(home, 'gh'),
      '#!/bin/sh\n[ "$1 $2" = "auth token" ] || exit 1\nprintf \'%s\\n\' "gho_fixture-token"\n',
      { mode: 0o755 },
    )
    const socket = join(home, 'S.gpg-agent.extra')
    await writeFile(
      join(home, 'gpgconf'),
      `#!/bin/sh\n[ "$1 $2" = "--list-dirs agent-extra-socket" ] || exit 1\nprintf '%s\\n' "${socket}"\n`,
      { mode: 0o755 },
    )
    agent = Bun.listen({ unix: socket, socket: { data() {} } })
  }

  it('reports push, signing and identity when the host has a token, an agent and a git config', async () => {
    await givenTokenAndSocket()

    const capabilities = await probeDockerCapabilities({
      cwd: home,
      env,
      read: reader({ 'config user.name': 'Operator', 'config user.email': 'operator@example.com' }),
    })

    expect(capabilities.canPush).toBe(true)
    expect(capabilities.gpgSigning).toBe(true)
    expect(capabilities.gitIdentity).toBe('Operator <operator@example.com>')
    expect(capabilities.dockerAvailable).toBe(true)
    expect(capabilities.persistentFs).toBe(true)
    expect(capabilities.serviceTtlSeconds).toBeNull()
    expect(capabilities.portExposure).toBe(EPortExposure.Localhost)
    expect(capabilities.failures).toEqual([])
  })

  it('reports no push, no signing and no identity when the host has none of them', async () => {
    const capabilities = await probeDockerCapabilities({
      cwd: home,
      env,
      read: reader({ 'config user.name': 'Operator' }),
    })

    expect(capabilities.canPush).toBe(false)
    expect(capabilities.gpgSigning).toBe(false)
    expect(capabilities.gitIdentity).toBeNull()
  })
})

describe('dockerCapabilitiesSource', () => {
  const capabilities: EnvironmentCapabilities = {
    canPush: true,
    gitIdentity: 'Operator <operator@example.com>',
    gpgSigning: true,
    dockerAvailable: true,
    persistentFs: true,
    serviceTtlSeconds: null,
    portExposure: EPortExposure.Localhost,
    failures: [],
  }

  it('answers nothing on the host and never probes', async () => {
    let probes = 0
    const source = dockerCapabilitiesSource({
      executionLocation: createExecutionLocationState({ initial: EExecutionLocation.Host }),
      cwd: '/w',
      env: {},
      probe: async () => {
        probes += 1
        return capabilities
      },
    })

    expect(source({ threadId: toThreadId('thread-1') })).toBeUndefined()
    await flush()
    expect(probes).toBe(0)
  })

  it('kicks the probe on the first Docker assembly and answers from the next one on', async () => {
    let probes = 0
    const source = dockerCapabilitiesSource({
      executionLocation: createExecutionLocationState({ initial: EExecutionLocation.Docker }),
      cwd: '/w',
      env: {},
      probe: async () => {
        probes += 1
        return capabilities
      },
    })

    expect(source({ threadId: toThreadId('thread-1') })).toBeUndefined()
    await flush()
    expect(source({ threadId: toThreadId('thread-1') })).toEqual(capabilities)
    expect(source({ threadId: toThreadId('thread-1') })).toEqual(capabilities)
    expect(probes).toBe(1)
  })

  it('follows a thread noted onto Docker rather than the session default', async () => {
    const location = createExecutionLocationState({ initial: EExecutionLocation.Host })
    location.note({ threadId: toThreadId('thread-1'), location: EExecutionLocation.Docker })
    const source = dockerCapabilitiesSource({
      executionLocation: location,
      cwd: '/w',
      env: {},
      probe: async () => capabilities,
    })

    source({ threadId: toThreadId('thread-1') })
    await flush()
    expect(source({ threadId: toThreadId('thread-1') })).toEqual(capabilities)
    expect(source({ threadId: toThreadId('thread-2') })).toBeUndefined()
  })

  it('swallows a throwing probe into a permanent undefined instead of rejecting into assembly', async () => {
    let probes = 0
    const source = dockerCapabilitiesSource({
      executionLocation: createExecutionLocationState({ initial: EExecutionLocation.Docker }),
      cwd: '/w',
      env: {},
      probe: async () => {
        probes += 1
        throw new Error('container mode needs a platform that has uid and gid')
      },
    })

    expect(source({ threadId: toThreadId('thread-1') })).toBeUndefined()
    await flush()
    expect(source({ threadId: toThreadId('thread-1') })).toBeUndefined()
    expect(probes).toBe(1)
  })
})
