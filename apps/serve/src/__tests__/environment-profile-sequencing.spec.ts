import { describe, expect, it } from 'bun:test'

import { EProfileStep } from '../environment-profile'

import { CWD, harness, seededScan, spec } from './environment-profile-fixture'

describe('environment profile step order', () => {
  it('keeps the recorded step order stable', async () => {
    const { apply } = harness({ present: [`${CWD}/.git`], runAnswers: seededScan })

    const profile = await apply({ cwd: CWD, spec: spec() })

    expect(profile.steps.map((one) => one.step)).toEqual([
      EProfileStep.Credentials,
      EProfileStep.KnownHosts,
      EProfileStep.Toolchain,
    ])
  })

  it('probes docker concurrently with the profile chain without holding the toolchain', async () => {
    const { apply, events } = harness({
      present: [`${CWD}/bun.lock`, `${CWD}/.atlas/sandbox-setup.sh`],
      runAnswers: seededScan,
    })

    const profile = await apply({ cwd: CWD, spec: spec() })

    expect(events.some((event) => event === 'docker info')).toBe(true)
    expect(events).toContain('sh .atlas/sandbox-setup.sh')
    expect(profile.capabilities.dockerAvailable).toBe(true)
  })
})
