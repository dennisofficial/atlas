import { describe, expect, it } from 'bun:test'

import { ECloudSandboxState } from '@dltech/atlas-harness'

import { cloudSandboxBadge } from '../thread-badges'
import { theme } from '../theme'

describe('the cloud sandbox badge', () => {
  it('is a green cloud while the sandbox runs', () => {
    expect(cloudSandboxBadge({ state: ECloudSandboxState.Running })).toEqual({
      text: '☁ running',
      fg: theme.ok,
    })
  })

  it('is a moon while the sandbox is parked', () => {
    expect(cloudSandboxBadge({ state: ECloudSandboxState.Parked })).toEqual({
      text: '☾ parked',
      fg: theme.hint,
    })
  })

  it('is a warning cloud while the sandbox resumes', () => {
    expect(cloudSandboxBadge({ state: ECloudSandboxState.Resuming })).toEqual({
      text: '☁ resuming',
      fg: theme.warn,
    })
  })

  it('says only cloud before the state read lands', () => {
    expect(cloudSandboxBadge({ state: undefined })).toEqual({
      text: '☁ cloud',
      fg: theme.hint,
    })
  })
})
