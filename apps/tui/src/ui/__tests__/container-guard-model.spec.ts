import { describe, expect, it } from 'bun:test'

import { EExecutionLocation } from '@dltech/atlas-core'

import {
  CONTAINER_GUARD_OPTIONS,
  containerGuardHeading,
  EContainerGuardChoice,
  openContainerGuard,
} from '../container-guard-model'

describe('container guard options', () => {
  it('offers switching and staying in that order', () => {
    expect(CONTAINER_GUARD_OPTIONS.map((option) => option.choice)).toEqual([
      EContainerGuardChoice.SwitchAndStop,
      EContainerGuardChoice.Stay,
    ])
  })

  it('opens on switch-and-stop', () => {
    expect(openContainerGuard()).toEqual({ selected: 0 })
  })
})

describe('container guard heading', () => {
  it('names the container when moving into one', () => {
    expect(containerGuardHeading(EExecutionLocation.Docker)).toBe(
      'Moving this conversation into a container',
    )
  })

  it('names the host when moving back', () => {
    expect(containerGuardHeading(EExecutionLocation.Host)).toBe(
      'Moving this conversation back to the host',
    )
  })

  it('names the cloud when moving to a sandbox', () => {
    expect(containerGuardHeading(EExecutionLocation.Cloud)).toBe(
      'Moving this conversation to the cloud',
    )
  })
})
