import { describe, expect, it } from 'bun:test'

import type { PluginPodContext, PodAnalytics } from '@dltech/atlas-plugin-sdk'
import { ECallStatus, EPreviewRedialReason, type PreviewTunnelRedial } from '@dltech/atlas-protocol'

import { servicesPod } from '..'
import { recordServiceFrame } from '../frames'
import { captureLastPreviewRedial } from '../preview-analytics'
import { stateFor } from '../state'
import { rig, settle } from './support'

const REDIAL: PreviewTunnelRedial = {
  id: 'redial-1',
  reason: EPreviewRedialReason.Freeze,
  gapMs: 16_000,
  skewMs: 15_000,
  stopMs: 120,
  registerMs: 2_345,
  ok: true,
}

const harnessOf = () => {
  const harness = rig()
  const captured: Parameters<PodAnalytics['capture']>[0][] = []
  const ctx: PluginPodContext = {
    ...harness.ctx,
    analytics: { capture: (args) => captured.push(args) },
    call: async (op, options) =>
      op.op === 'previews.status'
        ? {
            status: ECallStatus.Ok,
            op: op.op,
            value: { state: 'up', restarts: 1, tail: '', lastRedial: REDIAL },
          }
        : harness.ctx.call(op, options),
  }
  return { ...harness, ctx, captured }
}

describe('preview redial analytics', () => {
  it('captures the direct daemon frame without writing events or waking a turn', async () => {
    const harness = harnessOf()
    const frame = { kind: 'event', event: { type: 'previews.redialed', ...REDIAL } } as const
    await recordServiceFrame({ ctx: harness.ctx, state: stateFor(harness.ctx), frame })
    await recordServiceFrame({ ctx: harness.ctx, state: stateFor(harness.ctx), frame })
    expect(harness.captured).toEqual([
      {
        event: 'preview_tunnel_redial',
        properties: {
          redial_id: 'redial-1',
          reason: 'freeze',
          gap_ms: 16_000,
          skew_ms: 15_000,
          stop_ms: 120,
          register_ms: 2_345,
          ok: true,
        },
      },
    ])
    expect(harness.log).toEqual([])
    expect(harness.notices).toEqual([])
  })

  it('captures an unlinked redial from retained status on attach, once across ready and direct delivery', async () => {
    const harness = harnessOf()
    servicesPod.hooks?.(harness.ctx)
    servicesPod.onDaemonReady?.({ ctx: harness.ctx, hello: { bootId: 'b2', restart: false } })
    await settle()
    await captureLastPreviewRedial(harness.ctx)
    const frame = { kind: 'event', event: { type: 'previews.redialed', ...REDIAL } } as const
    for (const listener of harness.listeners) listener(frame)
    await settle()
    expect(harness.captured).toHaveLength(1)
    expect(harness.log).toEqual([])
    expect(harness.notices).toEqual([])
  })

  it('keeps a stable redial id when a new holder reads the retained redial', async () => {
    const harness = harnessOf()
    await captureLastPreviewRedial(harness.ctx)
    await captureLastPreviewRedial({ ...harness.ctx })
    expect(harness.captured).toHaveLength(2)
    expect(harness.captured[0]?.properties.redial_id).toBe(
      harness.captured[1]?.properties.redial_id,
    )
  })

  it('accepts a daemon without a retained redial and an unavailable daemon', async () => {
    const harness = harnessOf()
    const ctx: PluginPodContext = {
      ...harness.ctx,
      call: async () => ({
        status: ECallStatus.Ok,
        op: 'previews.status',
        value: { state: 'up', restarts: 0, tail: '' },
      }),
    }
    await captureLastPreviewRedial(ctx)
    await captureLastPreviewRedial({
      ...ctx,
      call: async () => {
        throw new Error('offline')
      },
    })
    expect(harness.captured).toEqual([])
  })
})
