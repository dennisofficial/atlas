import { describe, expect, it } from 'bun:test'

import { EPortExposure } from '@dltech/atlas-core'

import { EProfileStep, EProfileStepState } from '../environment-profile'
import { SERVE_IDLE_MINUTES_WITH_SERVICES } from '../idle-stop'

import { CWD, harness, outcomeOf, seededScan, spec, TOKEN } from './environment-profile-fixture'

describe('environment profile as a whole', () => {
  it('never lets the spec token leak into an outcome detail', async () => {
    const { apply } = harness({
      runFails: (attempt) =>
        attempt.command[0] === 'ssh-keyscan'
          ? { stderr: `dial failed for ${TOKEN} with ${TOKEN}` }
          : undefined,
    })

    const profile = await apply({ cwd: CWD, spec: spec() })

    expect(outcomeOf(profile, EProfileStep.KnownHosts).state).toBe(EProfileStepState.Failed)
    expect(JSON.stringify(profile)).not.toContain(TOKEN)
    expect(JSON.stringify(profile)).toContain('***')
  })

  it('reports the full capabilities shape when every step applies', async () => {
    const { apply } = harness({
      present: [`${CWD}/.git`, `${CWD}/bun.lock`],
      runAnswers: seededScan,
    })

    const profile = await apply({
      cwd: CWD,
      spec: spec({ gitIdentity: { name: 'Dennis', email: 'dennis@example.com' } }),
    })

    expect(profile.capabilities).toEqual({
      canPush: true,
      gitIdentity: 'Dennis <dennis@example.com>',
      gpgSigning: false,
      dockerAvailable: true,
      persistentFs: true,
      serviceTtlSeconds: SERVE_IDLE_MINUTES_WITH_SERVICES * 60,
      portExposure: EPortExposure.PublicDomain,
      failures: [],
    })
  })

  it('probes docker through the shimmed cli rather than assuming it', async () => {
    const { apply, commands } = harness({ runAnswers: seededScan })

    const profile = await apply({ cwd: CWD, spec: spec() })

    expect(profile.capabilities.dockerAvailable).toBe(true)
    expect(commands.some((one) => one.command.join(' ') === 'docker info')).toBe(true)
  })

  it('reports docker unavailable when the probe does not answer ok', async () => {
    const { apply } = harness({
      runAnswers: seededScan,
      runFails: (attempt) =>
        attempt.command[0] === 'docker' ? { stderr: 'no daemon is reachable' } : undefined,
    })

    const profile = await apply({ cwd: CWD, spec: spec() })

    expect(profile.capabilities.dockerAvailable).toBe(false)
  })

  it('carries the configured service TTL into the capabilities rather than assuming one', async () => {
    const { apply } = harness({ serviceTtlSeconds: 42 * 60 })

    const profile = await apply({ cwd: CWD, spec: spec() })

    expect(profile.capabilities.serviceTtlSeconds).toBe(42 * 60)
  })
})
