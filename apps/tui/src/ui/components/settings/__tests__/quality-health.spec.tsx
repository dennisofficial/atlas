import {
  EQualityHealthStatus,
  EQualitySkipReason,
  QUALITY_HEALTH_LABEL,
  toThreadId,
  type QualityHealth,
} from '@dltech/atlas-core'
import { testRender } from '@opentui/react/test-utils'
import { afterAll, describe, expect, it } from 'bun:test'
import React from 'react'

import { EQualityHealthReadKind } from '../../../../composition/use-quality-health'
import { QualityHealthStatus } from '../quality-health'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const THREAD = toThreadId('thread-visible-01')

const CELLS = 100

type Setup = Awaited<ReturnType<typeof testRender>>

const mounted: Setup[] = []

afterAll(() => {
  for (const setup of mounted) setup.renderer.destroy()
})

const healthFixture = (overrides: Partial<QualityHealth> = {}): QualityHealth => ({
  label: QUALITY_HEALTH_LABEL,
  status: EQualityHealthStatus.CompletedNoFinding,
  path: 'src/widget.ts',
  scope: { id: 'scope-1', name: 'Widget', kind: 'class' },
  policyIds: ['srp'],
  recordedAt: '2026-10-06T10:00:00.000Z',
  ...overrides,
})

async function renderStatus(args: {
  read: React.ComponentProps<typeof QualityHealthStatus>['read']
  enabled?: boolean
  recording?: boolean
  cells?: number
  width?: number
}): Promise<string> {
  const setup = await testRender(
    <QualityHealthStatus
      read={args.read}
      enabled={args.enabled ?? false}
      recording={args.recording ?? false}
      threadId={THREAD}
      cells={args.cells ?? CELLS}
    />,
    { width: args.width ?? 120, height: 6 },
  )
  mounted.push(setup)
  await setup.flush()
  return setup.captureCharFrame()
}

describe('the code-quality recorded-status block', () => {
  it('labels itself as the last recorded review with the control state and viewed thread', async () => {
    const frame = await renderStatus({
      read: { kind: EQualityHealthReadKind.Ready, health: healthFixture() },
      enabled: true,
      recording: true,
    })

    expect(frame).toContain('last recorded review')
    expect(frame).toContain('review enabled')
    expect(frame).toContain('recording on')
    expect(frame).toContain('thread thread-vis')
  })

  it('never claims live endpoint health or a clean current tree', async () => {
    const frame = await renderStatus({
      read: { kind: EQualityHealthReadKind.Ready, health: healthFixture() },
    })

    expect(frame).not.toContain('healthy')
    expect(frame).not.toContain('all files')
    expect(frame).not.toContain('clean')
  })

  it('explains the initial coverage: direct TS/JS file tools only', async () => {
    const frame = await renderStatus({
      read: { kind: EQualityHealthReadKind.Ready, health: healthFixture() },
      cells: 150,
      width: 150,
    })

    expect(frame).toContain('TypeScript and JavaScript files only')
    expect(frame).toContain('shell commands and outside tools are not reviewed')
  })

  it('says there is no recorded review instead of implying a clean review', async () => {
    const frame = await renderStatus({
      read: {
        kind: EQualityHealthReadKind.Ready,
        health: healthFixture({
          status: EQualityHealthStatus.NoReview,
          path: null,
          scope: null,
          policyIds: [],
          recordedAt: null,
        }),
      },
    })

    expect(frame).toContain('no recorded review')
    expect(frame).not.toContain('src/widget.ts')
  })

  it('scopes a clean outcome to the reviewed scope, with its path and time', async () => {
    const frame = await renderStatus({
      read: { kind: EQualityHealthReadKind.Ready, health: healthFixture() },
    })

    expect(frame).toContain('completed, no finding in the reviewed scope')
    expect(frame).toContain('src/widget.ts')
    expect(frame).toContain('class Widget')
    expect(frame).toContain('2026-10-06T10:00')
  })

  it('reports a finding as a finding, not as failure or cleanliness', async () => {
    const frame = await renderStatus({
      read: {
        kind: EQualityHealthReadKind.Ready,
        health: healthFixture({ status: EQualityHealthStatus.Finding }),
      },
    })

    expect(frame).toContain('completed, finding in the reviewed scope')
  })

  it('reports skipped, inconclusive and operational-error outcomes distinctly', async () => {
    const skipped = await renderStatus({
      read: {
        kind: EQualityHealthReadKind.Ready,
        health: healthFixture({
          status: EQualityHealthStatus.Skipped,
          reason: EQualitySkipReason.UnsupportedLanguage,
        }),
      },
    })
    expect(skipped).toContain('skipped')
    expect(skipped).toContain('unsupported_language')

    const inconclusive = await renderStatus({
      read: {
        kind: EQualityHealthReadKind.Ready,
        health: healthFixture({ status: EQualityHealthStatus.Inconclusive }),
      },
    })
    expect(inconclusive).toContain('inconclusive')

    const errored = await renderStatus({
      read: {
        kind: EQualityHealthReadKind.Ready,
        health: healthFixture({ status: EQualityHealthStatus.OperationalError }),
      },
    })
    expect(errored).toContain('operational error')
  })

  it('shows a reading state on first open without pretending a review exists', async () => {
    const frame = await renderStatus({ read: { kind: EQualityHealthReadKind.Loading } })

    expect(frame).toContain('reading')
    expect(frame).not.toContain('no recorded review')
  })

  it('keeps the last known outcome visible and marked when a refresh fails', async () => {
    const frame = await renderStatus({
      read: {
        kind: EQualityHealthReadKind.Unavailable,
        lastKnown: healthFixture({ status: EQualityHealthStatus.Finding }),
        reason: 'log moved away',
      },
    })

    expect(frame).toContain('completed, finding in the reviewed scope')
    expect(frame).toContain('unavailable')
    expect(frame).toContain('log moved away')
  })

  it('says unavailable, never no-review, when a first read fails', async () => {
    const frame = await renderStatus({
      read: {
        kind: EQualityHealthReadKind.Unavailable,
        lastKnown: null,
        reason: 'log moved away',
      },
    })

    expect(frame).toContain('unavailable')
    expect(frame).not.toContain('no recorded review')
  })

  it('names the policies of the last recorded review', async () => {
    const frame = await renderStatus({
      read: {
        kind: EQualityHealthReadKind.Ready,
        health: healthFixture({ policyIds: ['srp', 'naming'] }),
      },
    })

    expect(frame).toContain('srp, naming')
  })

  it('keeps the last known path, scope and time visible when a refresh fails', async () => {
    const frame = await renderStatus({
      read: {
        kind: EQualityHealthReadKind.Unavailable,
        lastKnown: healthFixture({ status: EQualityHealthStatus.Finding }),
        reason: 'log moved away',
      },
      cells: 150,
      width: 150,
    })

    expect(frame).toContain('src/widget.ts')
    expect(frame).toContain('class Widget')
    expect(frame).toContain('2026-10-06T10:00')
  })

  it('keeps the coverage limits readable at narrow widths instead of clipping them away', async () => {
    const frame = await renderStatus({
      read: { kind: EQualityHealthReadKind.Ready, health: healthFixture() },
      cells: 40,
    })

    const unwrapped = frame.split('\n').map((line) => line.trim()).join(' ')
    expect(unwrapped).toContain('TypeScript and JavaScript files only')
    expect(unwrapped).toContain('shell commands and outside tools are not reviewed')
    for (const line of frame.split('\n')) {
      expect([...line.trimEnd()].length).toBeLessThanOrEqual(40)
    }
  })

  it('clips the readout to the available cells instead of overflowing', async () => {
    const frame = await renderStatus({
      read: { kind: EQualityHealthReadKind.Ready, health: healthFixture() },
      enabled: true,
      cells: 40,
    })

    const firstLine = frame.split('\n').find((line) => line.includes('last recorded review'))
    expect(firstLine).toBeDefined()
    expect([...(firstLine ?? '').trimEnd()].length).toBeLessThanOrEqual(40)
    expect(firstLine).toContain('thread thread-vis')
    expect(frame).not.toContain('recording on')
  })
})
