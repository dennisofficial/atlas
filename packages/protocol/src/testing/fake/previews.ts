import { defineOp, type DaemonGroupFactory } from '../../engine'
import type { PreviewInfo } from '../../ops'

export const fakePreviewsGroup = (): DaemonGroupFactory => () => {
  const previews = new Map<number, number>()
  let nextPid = 5000

  return {
    name: 'previews',
    ops: [
      defineOp({
        op: 'previews.expose',
        run: ({ op }) => {
          nextPid += 1
          previews.set(op.port, nextPid)
          return Promise.resolve<PreviewInfo>({ port: op.port, pid: nextPid })
        },
      }),
      defineOp({
        op: 'previews.stop',
        run: ({ op }) => Promise.resolve({ stopped: previews.delete(op.port) }),
      }),
      defineOp({
        op: 'previews.list',
        run: () =>
          Promise.resolve(
            [...previews].map(([port, pid]) => ({ port, pid }) satisfies PreviewInfo),
          ),
      }),
    ],
    stop: async () => {
      previews.clear()
    },
  }
}
