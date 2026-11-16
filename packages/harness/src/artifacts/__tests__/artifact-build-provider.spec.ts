import { describe, expect, it } from 'bun:test'

import { EArtifactBuildOutcome, ESubscriptionStatus, toThreadId } from '@dltech/atlas-core'

import { ArtifactNotFound } from '../artifact-port'
import {
  ARTIFACT_BUILD_PROVIDER_KIND,
  createArtifactBuildProvider,
  type ArtifactBuildTarget,
} from '../artifact-build-provider'
import { EOccurrenceUrgency, type SubscriptionOccurrence } from '../../subscriptions/provider'

import { FakeArtifactPort } from '../../tools/builtin/__tests__/artifact-fakes'

const TICK_MS = 10

const subscriptionOf = (target: unknown) => ({
  id: 'sub_artifact',
  provider: ARTIFACT_BUILD_PROVIDER_KIND,
  target: target as never,
  label: 'artifact demo v3 build',
  threadId: toThreadId('thr_1'),
  createdBy: 'agent' as never,
  status: ESubscriptionStatus.Active,
  createdAt: '2026-11-16T00:00:00.000Z',
})

const waitFor = async (done: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 200 && !done(); attempt += 1) {
    await Bun.sleep(TICK_MS)
  }
}

const rigOf = (args?: { target?: unknown }) => {
  const port = new FakeArtifactPort()
  const provider = createArtifactBuildProvider({ port, tickMs: TICK_MS })
  const occurrences: SubscriptionOccurrence[] = []
  const stop = provider.start({
    subscription: subscriptionOf(args?.target ?? { subdomain: 'demo', version: 3 }),
    emit: (occurrence) => occurrences.push(occurrence),
  })
  return { port, provider, occurrences, stop }
}

describe('artifact.build resolve', () => {
  it('reads <subdomain>@<version> out of the target', async () => {
    const provider = createArtifactBuildProvider({ port: new FakeArtifactPort() })

    const resolved = await provider.resolve({
      input: 'demo@3',
      threadId: toThreadId('thr_1'),
      projectDirectory: '/ws',
    })

    expect(resolved).toEqual({
      target: { subdomain: 'demo', version: 3 } satisfies ArtifactBuildTarget,
      label: 'artifact demo v3 build',
    })
  })

  it.each(['demo', 'demo@', '@3', 'demo@0', 'demo@three', 'Not_A_Subdomain@3'])(
    'refuses %s',
    async (input) => {
      const provider = createArtifactBuildProvider({ port: new FakeArtifactPort() })

      const resolved = await provider.resolve({
        input,
        threadId: toThreadId('thr_1'),
        projectDirectory: '/ws',
      })

      expect(resolved).toHaveProperty('error')
    },
  )
})

describe('artifact.build polling', () => {
  it('waits while the build is still building', async () => {
    const rig = rigOf()

    await waitFor(() => rig.port.buildStatusCalls.length >= 3)

    expect(rig.port.buildStatusCalls[0]).toEqual({ subdomain: 'demo', version: 3 })
    expect(rig.occurrences).toHaveLength(0)
    rig.stop()
  })

  it('emits one urgent occurrence that ends the subscription when a build is ready', async () => {
    const rig = rigOf()
    rig.port.buildOutcome = 'ready'
    rig.port.buildDurationMs = 41_000

    await waitFor(() => rig.occurrences.length > 0)
    rig.stop()

    expect(rig.occurrences).toHaveLength(1)
    const [occurrence] = rig.occurrences
    expect(occurrence).toMatchObject({
      key: 'artifact-build:demo:3:ready',
      urgency: EOccurrenceUrgency.Now,
      ends: true,
    })
    expect(occurrence?.draft).toEqual({
      type: 'artifact-build-event',
      subdomain: 'demo',
      version: 3,
      url: 'https://demo.artifacts.test',
      outcome: EArtifactBuildOutcome.Ready,
      eventId: 'artifact-build:demo:3:ready',
      durationMs: 41_000,
    })
  })

  it('carries the failure and the log tail of a failed build', async () => {
    const rig = rigOf()
    rig.port.buildOutcome = 'failed'
    rig.port.buildFailure = 'vite: 3 TypeErrors'
    rig.port.buildLog = 'error: cannot resolve ./app'

    await waitFor(() => rig.occurrences.length > 0)
    rig.stop()

    expect(rig.occurrences[0]?.draft).toMatchObject({
      outcome: EArtifactBuildOutcome.Failed,
      failure: 'vite: 3 TypeErrors',
      log: 'error: cannot resolve ./app',
    })
  })

  it('caps the log tail it carries', async () => {
    const rig = rigOf()
    rig.port.buildOutcome = 'failed'
    rig.port.buildLog = `${'x'.repeat(10_000)}END`

    await waitFor(() => rig.occurrences.length > 0)
    rig.stop()

    const log =
      rig.occurrences[0]?.draft.type === 'artifact-build-event'
        ? rig.occurrences[0].draft.log
        : undefined
    expect(log?.endsWith('END')).toBe(true)
    expect(log?.length).toBe(4_000)
  })

  it('names the version that superseded it', async () => {
    const rig = rigOf()
    rig.port.buildOutcome = 'superseded'
    rig.port.buildSupersededBy = 4

    await waitFor(() => rig.occurrences.length > 0)
    rig.stop()

    expect(rig.occurrences[0]?.draft).toMatchObject({
      outcome: EArtifactBuildOutcome.Superseded,
      supersededBy: 4,
    })
  })

  it('keeps polling through errors that are not a vanished artifact', async () => {
    const rig = rigOf()
    rig.port.buildStatusFailure = new Error('HTTP 503')
    await waitFor(() => rig.port.buildStatusCalls.length >= 2)
    expect(rig.occurrences).toHaveLength(0)

    rig.port.buildStatusFailure = null
    rig.port.buildOutcome = 'ready'
    await waitFor(() => rig.occurrences.length > 0)
    rig.stop()

    expect(rig.occurrences).toHaveLength(1)
  })

  it('reports a vanished artifact as a failure rather than polling forever', async () => {
    const rig = rigOf()
    rig.port.buildStatusFailure = new ArtifactNotFound('no artifact demo')

    await waitFor(() => rig.occurrences.length > 0)
    rig.stop()

    expect(rig.occurrences[0]?.draft).toMatchObject({
      outcome: EArtifactBuildOutcome.Failed,
      failure: 'the artifact no longer exists',
    })
    expect(rig.occurrences[0]?.draft).not.toHaveProperty('url')
  })

  it('stops polling once stopped, and emits nothing more', async () => {
    const rig = rigOf()
    rig.stop()
    const seen = rig.port.buildStatusCalls.length

    await Bun.sleep(TICK_MS * 5)

    expect(rig.port.buildStatusCalls.length).toBe(seen)
    expect(rig.occurrences).toHaveLength(0)
  })

  it('does not start on a target it cannot read', async () => {
    const rig = rigOf({ target: 'demo' })

    await Bun.sleep(TICK_MS * 3)
    rig.stop()

    expect(rig.port.buildStatusCalls).toHaveLength(0)
  })
})
