import { describe, expect, it } from 'bun:test'

import { EExecutionLocation } from '@dltech/atlas-core'

import { ExecutionLocationFragment } from '../fragments/environment'

describe('the execution-location fragment', () => {
  it('tells a host session it can move itself into the docker sandbox', () => {
    const fragment = new ExecutionLocationFragment(() => EExecutionLocation.Host)

    expect(fragment.text()).toContain('execution_location')
    expect(fragment.text()).toContain('Docker container sandbox')
    expect(fragment.stamp()).toBe(EExecutionLocation.Host)
  })

  it('tells a container session how to come back to the host', () => {
    const fragment = new ExecutionLocationFragment(() => EExecutionLocation.Docker)

    expect(fragment.text()).toContain('inside a Docker container sandbox')
    expect(fragment.text()).toContain('"host"')
  })

  it('says nothing in the cloud, where moving is the operator’s call', () => {
    expect(new ExecutionLocationFragment(() => EExecutionLocation.Cloud).text()).toBe('')
  })

  it('reads an unwired container as the host, which is where such a session runs', () => {
    const fragment = new ExecutionLocationFragment(() => undefined)

    expect(fragment.text()).toContain('host machine')
    expect(fragment.stamp()).toBe(EExecutionLocation.Host)
  })
})
