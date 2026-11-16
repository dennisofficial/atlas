import { describe, expect, it } from 'bun:test'

import { EArtifactBuildOutcome } from '../../../events/artifact-build-body'
import { eventBodySchema } from '../../../events/schema'
import { artifactBuildEventBlock, artifactBuildEventContent } from '../artifact-build-event-block'

const URL = 'https://demo.byatlas.site'

const ready = {
  type: 'artifact-build-event',
  subdomain: 'demo',
  version: 4,
  url: URL,
  outcome: EArtifactBuildOutcome.Ready,
  durationMs: 41_400,
} as const

describe('artifact build event content', () => {
  it('says a ready build is live at its url and how long it took', () => {
    expect(artifactBuildEventContent(ready)).toBe(
      `Artifact demo version 4 built and is live at ${URL} (41s).`,
    )
  })

  it('leaves the duration out when the server did not report one', () => {
    const { durationMs: _durationMs, ...noDuration } = ready
    expect(artifactBuildEventContent(noDuration)).toBe(
      `Artifact demo version 4 built and is live at ${URL}.`,
    )
  })

  it('says a failed build kept the source and still serves the last good build', () => {
    const content = artifactBuildEventContent({
      ...ready,
      outcome: EArtifactBuildOutcome.Failed,
      failure: 'vite: 3 TypeErrors',
    })

    expect(content).toBe(
      `Artifact demo version 4 failed to build: vite: 3 TypeErrors. The pushed source is stored; ${URL} still serves the last good build.`,
    )
  })

  it('appends the build log tail a failure carries', () => {
    const content = artifactBuildEventContent({
      ...ready,
      outcome: EArtifactBuildOutcome.Failed,
      failure: 'exit 1',
      log: 'error: cannot resolve ./app',
    })

    expect(content).toContain('Build log tail:\nerror: cannot resolve ./app')
  })

  it('names the version that superseded it', () => {
    expect(
      artifactBuildEventContent({
        ...ready,
        outcome: EArtifactBuildOutcome.Superseded,
        supersededBy: 5,
      }),
    ).toBe(
      "Artifact demo version 4 was superseded by version 5; its result arrives on that version's subscription.",
    )
  })

  it('says a supersede with no successor plainly', () => {
    expect(
      artifactBuildEventContent({ ...ready, outcome: EArtifactBuildOutcome.Superseded }),
    ).toContain('was superseded by a newer push;')
  })

  it('renders as a system notice so it reads as delivery, not operator speech', () => {
    const block = artifactBuildEventBlock(ready)
    expect(block).toContain('kind="artifact-build-event"')
    expect(block).toContain(URL)
  })
})

describe('artifact build event schema', () => {
  it('round-trips every outcome', () => {
    for (const outcome of Object.values(EArtifactBuildOutcome)) {
      const parsed = eventBodySchema.safeParse({ ...ready, outcome })
      expect(parsed.success, outcome).toBe(true)
    }
  })

  it('carries a failure, a log and the version that superseded it', () => {
    const parsed = eventBodySchema.safeParse({
      ...ready,
      outcome: EArtifactBuildOutcome.Superseded,
      failure: 'exit 2',
      log: 'tail',
      supersededBy: 6,
      eventId: 'artifact-build:demo:4:superseded',
    })

    expect(parsed.success).toBe(true)
    expect(parsed.data).toMatchObject({
      supersededBy: 6,
      eventId: 'artifact-build:demo:4:superseded',
    })
  })

  it('rejects an outcome the server never reports', () => {
    expect(eventBodySchema.safeParse({ ...ready, outcome: 'building' }).success).toBe(false)
  })
})
