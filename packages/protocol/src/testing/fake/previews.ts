import { defineOp, type DaemonGroupFactory } from '../../engine'
import type { PreviewTunnelStatus } from '../../ops'

const UP: PreviewTunnelStatus = { state: 'up', pid: 5000, restarts: 0, tail: '' }

export const fakePreviewsGroup = (): DaemonGroupFactory => () => ({
  name: 'previews',
  ops: [
    defineOp({ op: 'previews.ensure', run: () => Promise.resolve<PreviewTunnelStatus>(UP) }),
    defineOp({ op: 'previews.status', run: () => Promise.resolve<PreviewTunnelStatus>(UP) }),
  ],
})
