import { describe, expect, it } from 'bun:test'

import { EPortExposure } from '@dltech/atlas-core'

import type { EnvironmentProfile } from '../environment-profile'
import { EWorkspaceState, WORKSPACE_SENTINEL } from '../materialize-workspace'

import { CWD, harness, spec } from './materialize-workspace-fixture'

const profile: EnvironmentProfile = {
  steps: [],
  capabilities: {
    canPush: true,
    gitIdentity: null,
    gpgSigning: false,
    dockerAvailable: false,
    persistentFs: true,
    serviceTtlSeconds: null,
    portExposure: EPortExposure.PublicDomain,
    failures: [],
  },
}

describe('ensureWorkspace environment profile', () => {
  it('re-applies the profile on a present workspace, fetching the spec for it', async () => {
    let fetched = 0
    const { ensure } = harness({
      present: [`${CWD}/${WORKSPACE_SENTINEL}`],
      profile: async () => profile,
    })

    const readiness = await ensure({
      cwd: CWD,
      fetchSpec: async () => {
        fetched += 1
        return spec()
      },
    })

    expect(readiness).toEqual({ state: EWorkspaceState.Present, profile })
    expect(fetched).toBe(1)
  })

  it('carries the profile on a materialized workspace', async () => {
    const { ensure } = harness({ profile: async () => profile })

    const readiness = await ensure({ cwd: CWD, fetchSpec: async () => spec() })

    expect(readiness).toEqual({ state: EWorkspaceState.Materialized, profile })
  })

  it('applies the profile for a workspace-less session too', async () => {
    const { ensure } = harness({ profile: async () => profile })

    const readiness = await ensure({
      cwd: CWD,
      fetchSpec: async () => spec({ remoteUrl: null, branch: null, commit: null }),
    })

    expect(readiness).toEqual({ state: EWorkspaceState.Skipped, profile })
  })

  it('still returns the success readiness when the profile throws', async () => {
    const { ensure } = harness({
      profile: async () => {
        throw new Error('the profile blew up')
      },
    })

    const readiness = await ensure({ cwd: CWD, fetchSpec: async () => spec() })

    expect(readiness).toEqual({ state: EWorkspaceState.Materialized })
  })

  it('stays profile-less on a present workspace whose profile fetch throws', async () => {
    const { ensure } = harness({
      present: [`${CWD}/${WORKSPACE_SENTINEL}`],
      profile: async () => profile,
    })

    const readiness = await ensure({
      cwd: CWD,
      fetchSpec: async () => {
        throw new Error('the control plane answered 500')
      },
    })

    expect(readiness).toEqual({ state: EWorkspaceState.Present })
  })
})
