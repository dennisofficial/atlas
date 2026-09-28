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

  it('tells a container session how port publishing reaches the operator', () => {
    const text = new ExecutionLocationFragment(() => EExecutionLocation.Docker).text()

    expect(text).toContain('sandbox.localhost')
    expect(text).toContain('operator')
    expect(text).toContain('0.0.0.0')
    expect(text).toContain('same site')
  })

  it('tells a container session its own network proves nothing about the operator’s', () => {
    const text = new ExecutionLocationFragment(() => EExecutionLocation.Docker).text()

    expect(text).toContain('localhost is the container, not the operator’s machine')
    expect(text).toContain('never resolves inside the container')
  })

  it('tells a host session that previews still belong in the docker sandbox', () => {
    const text = new ExecutionLocationFragment(() => EExecutionLocation.Host).text()

    expect(text).toContain('sandbox.localhost')
    expect(text).toContain('operator')
  })

  it('tells a cloud session it runs sandboxed and cannot move itself', () => {
    const fragment = new ExecutionLocationFragment(() => EExecutionLocation.Cloud)

    expect(fragment.text()).toContain('cloud sandbox')
    expect(fragment.text()).toContain('operator’s machine')
    expect(fragment.text()).toContain('operator’s call')
    expect(fragment.text()).toContain('exposePort')
    expect(fragment.stamp()).toBe(EExecutionLocation.Cloud)
  })

  it('tells a cloud session it arrived on the branch with uncommitted work intact', () => {
    const fragment = new ExecutionLocationFragment(() => EExecutionLocation.Cloud)

    expect(fragment.text()).toContain('uncommitted work intact as uncommitted changes')
    expect(fragment.text()).toContain('merges by content')
  })

  it('reads an unwired container as the host, which is where such a session runs', () => {
    const fragment = new ExecutionLocationFragment(() => undefined)

    expect(fragment.text()).toContain('host machine')
    expect(fragment.stamp()).toBe(EExecutionLocation.Host)
  })
})
