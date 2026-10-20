import { describe, expect, it } from 'bun:test'

import { EExecutionLocation } from '@dltech/atlas-core'

import { reachableRootsFor } from '../reachable-files'

const PROJECT = '/Users/operator/Developer/project'

describe('reachableRootsFor', () => {
  it('leaves the host thread browsing the whole filesystem', () => {
    expect(
      reachableRootsFor({
        location: EExecutionLocation.Host,
        projectDirectory: PROJECT,
      }),
    ).toBeUndefined()
  })

  it('limits a container thread to the project', () => {
    expect(
      reachableRootsFor({
        location: EExecutionLocation.Docker,
        projectDirectory: PROJECT,
      }),
    ).toEqual([PROJECT])
  })
})
