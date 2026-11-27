import { describe, expect, it } from 'bun:test'

import { ECallStatus, type CallOp, type PreviewTunnelStatus } from '@dltech/atlas-protocol'

import { reconcilePreviewsReady, recordPreviewsReady } from '../previews-ready'
import { stateFor } from '../state'
import { rig } from './support'

const status = (overrides: Partial<PreviewTunnelStatus>): PreviewTunnelStatus => ({
  state: 'up',
  restarts: 0,
  tail: '',
  ...overrides,
})

const report = (args: { tunnel: PreviewTunnelStatus }) => {
  const harness = rig()
  const recorded: unknown[] = []
  const ctx = {
    ...harness.ctx,
    append: async (drafts: readonly unknown[]) => {
      recorded.push(...drafts)
    },
    call: async (op: CallOp) =>
      op.op === 'previews.status'
        ? ({ status: ECallStatus.Ok, op: 'previews.status', value: args.tunnel } as const)
        : harness.ctx.call(op),
  }
  return { recorded, ctx, state: stateFor(ctx) }
}

describe('reconcilePreviewsReady', () => {
  it('records the registration the daemon already made before the host listened', async () => {
    const { recorded, ctx, state } = report({ tunnel: status({ upAt: 'at-7' }) })
    await reconcilePreviewsReady({ ctx, state })
    expect(recorded).toEqual([{ type: 'previews-ready', at: 'at-7' }])
  })

  it('records nothing while the tunnel is not up', async () => {
    const { recorded, ctx, state } = report({ tunnel: status({ state: 'starting' }) })
    await reconcilePreviewsReady({ ctx, state })
    expect(recorded).toEqual([])
  })

  it('records a registration once, however often it is reported', async () => {
    const { recorded, ctx, state } = report({ tunnel: status({ upAt: 'at-7' }) })
    await recordPreviewsReady({ ctx, state, at: 'at-7' })
    await reconcilePreviewsReady({ ctx, state })
    await reconcilePreviewsReady({ ctx, state })
    expect(recorded).toHaveLength(1)
  })
})
