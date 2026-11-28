import { describe, expect, it } from 'bun:test'

import { daemonEventSchema, EPreviewRedialReason, previewTunnelStatusSchema } from '../index'

const redial = {
  id: 'redial-1',
  reason: EPreviewRedialReason.Freeze,
  gapMs: 16_000,
  skewMs: 15_000,
  stopMs: 12,
  registerMs: 2_500,
  ok: true,
}

describe('preview tunnel telemetry', () => {
  it('carries a completed redial as a daemon event', () => {
    const event = { type: 'previews.redialed', ...redial } as const
    expect(daemonEventSchema.parse(event)).toEqual(event)
  })

  it('retains the last redial in status and accepts status from an older daemon', () => {
    const status = { state: 'up', restarts: 1, tail: '' } as const
    expect(previewTunnelStatusSchema.parse(status)).toEqual(status)
    expect(previewTunnelStatusSchema.parse({ ...status, lastRedial: redial })).toEqual({
      ...status,
      lastRedial: redial,
    })
  })

  it('rejects invalid reasons and negative durations', () => {
    expect(
      daemonEventSchema.safeParse({ type: 'previews.redialed', ...redial, reason: 'other' })
        .success,
    ).toBe(false)
    expect(
      daemonEventSchema.safeParse({ type: 'previews.redialed', ...redial, stopMs: -1 }).success,
    ).toBe(false)
  })
})
