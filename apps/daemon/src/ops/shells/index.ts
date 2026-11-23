import { CallFailureError, ECallFailure } from '@dltech/atlas-protocol'
import { type DaemonGroupFactory, defineOp } from '@dltech/atlas-protocol/engine'

import type { DaemonOpsDeps } from '../deps'
import { shellsRegistryOf } from './registry'

export const shellsGroup =
  (deps: DaemonOpsDeps): DaemonGroupFactory =>
  (groupCtx) => {
    const registry = shellsRegistryOf(deps)
    registry.attach(groupCtx.publish)

    return {
      name: 'shells',
      ops: [
        defineOp({ op: 'shells.launch', run: ({ op }) => registry.launch(op) }),
        defineOp({
          op: 'shells.read',
          run: async ({ op }) => {
            const record = registry.shellOf(op.shellId)
            const chunk = await registry.store.readOutput({
              shellId: op.shellId,
              offset: op.offset,
              limit: op.limit,
            })
            return {
              offset: chunk.offset,
              bytes: Buffer.from(chunk.bytes).toString('base64'),
              totalBytes: chunk.totalBytes,
              info: record.info(),
            }
          },
        }),
        defineOp({
          op: 'shells.write',
          run: async ({ op }) => {
            registry.shellOf(op.shellId)
            const entry = registry.running.get(op.shellId)
            if (entry === undefined || !entry.process.acceptsInput()) {
              throw new CallFailureError({
                code: ECallFailure.InvalidInput,
                message: `shell ${op.shellId} was not launched with input`,
              })
            }
            if (entry.inputEnded) {
              throw new CallFailureError({
                code: ECallFailure.InvalidInput,
                message: `shell ${op.shellId} input is already ended`,
              })
            }
            if (op.data.length > 0) entry.process.writeInput(new TextEncoder().encode(op.data))
            if (op.end === true) {
              entry.inputEnded = true
              entry.process.closeInput()
            }
            return null
          },
        }),
        defineOp({ op: 'shells.kill', run: ({ op }) => registry.kill(op.shellId) }),
        defineOp({
          op: 'shells.list',
          run: async () => registry.store.list().map((record) => record.info()),
        }),
      ],
      stop: () => registry.stop(),
    }
  }
