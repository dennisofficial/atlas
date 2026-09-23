import { describe, expect, it } from 'bun:test'

import { EExecutionLocation, type Event } from '@dltech/atlas-core'

import { createCloudCheckout } from '../cloud-checkout'
import { EForge } from '../pure'

let nextSeq = 0

const event = (body: Record<string, unknown>): Event => {
  nextSeq += 1
  return {
    id: `evt_${nextSeq}`,
    seq: nextSeq,
    threadId: 'br_1',
    runId: 'run_1',
    depth: 0,
    at: '2026-09-22T12:00:00.000Z',
    ...body,
  } as Event
}

const lifted = (args?: { remoteUrl?: string; branch?: string }): Event =>
  event({
    type: 'location-changed',
    from: EExecutionLocation.Host,
    to: EExecutionLocation.Cloud,
    cwd: '/workspace',
    remoteUrl: args?.remoteUrl ?? 'git@github.com:dennisofficial/atlas.git',
    branch: args?.branch ?? 'dennis/lifted',
  })

const descended = (): Event =>
  event({ type: 'location-changed', from: EExecutionLocation.Cloud, to: EExecutionLocation.Host })

describe('the cloud checkout projection', () => {
  it('is null for a local thread', () => {
    const projection = createCloudCheckout()

    projection.publish({ events: [event({ type: 'user-said', text: 'hi' })] })

    expect(projection.current()).toBeNull()
  })

  it('folds the lift-time identity into a checkout on the sandbox path', () => {
    const projection = createCloudCheckout()

    projection.publish({ events: [lifted()] })

    expect(projection.current()).toEqual({
      directory: '/workspace',
      branch: 'dennis/lifted',
      forge: EForge.GitHub,
      remote: { host: 'github.com', owner: 'dennisofficial', repo: 'atlas' },
    })
  })

  it('holds the same reference across a republish of the same log', () => {
    const projection = createCloudCheckout()
    const events = [lifted()]

    projection.publish({ events })
    const first = projection.current()
    const version = projection.version()
    projection.publish({ events: [...events, event({ type: 'user-said', text: 'more' })] })

    expect(projection.current()).toBe(first)
    expect(projection.version()).toBe(version)
  })

  it('clears when the thread comes back to the host', () => {
    const projection = createCloudCheckout()

    projection.publish({ events: [lifted()] })
    projection.publish({ events: [lifted(), descended()] })

    expect(projection.current()).toBeNull()
  })

  it('is null for a lift whose remote does not parse', () => {
    const projection = createCloudCheckout()

    projection.publish({ events: [lifted({ remoteUrl: 'not-a-url' })] })

    expect(projection.current()).toBeNull()
  })
})
