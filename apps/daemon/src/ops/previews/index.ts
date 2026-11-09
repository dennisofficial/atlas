import {
  CallFailureError,
  ECallFailure,
  type PreviewInfo,
  type PreviewsExposeOp,
} from '@dltech/atlas-protocol'
import { type DaemonGroupFactory, defineOp } from '@dltech/atlas-protocol/engine'

import { ManagedProcess } from '../../process/managed'
import type { DaemonOpsDeps } from '../deps'

const BINARY = 'cloudflared'

type RunningPreview = { info: PreviewInfo; child: ManagedProcess }

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const cloudflaredOf = (env: Record<string, string | undefined>): string | undefined =>
  Bun.which(BINARY, env.PATH === undefined ? {} : { PATH: env.PATH }) ?? undefined

export const previewsGroup =
  (deps: DaemonOpsDeps): DaemonGroupFactory =>
  () => {
    const records = new Map<number, RunningPreview>()

    const stopPort = async (port: number): Promise<boolean> => {
      const record = records.get(port)
      if (record === undefined) return false
      records.delete(port)
      record.child.kill()
      try {
        await record.child.exit()
      } catch {
        records.delete(port)
      }
      return true
    }

    const expose = async (op: PreviewsExposeOp): Promise<PreviewInfo> => {
      const binary = cloudflaredOf(deps.env)
      if (binary === undefined) {
        throw new CallFailureError({
          code: ECallFailure.SpawnFailed,
          message: `this pod has no cloudflared binary, so port ${op.port} cannot be published`,
        })
      }
      await stopPort(op.port)
      let child: ManagedProcess
      try {
        child = ManagedProcess.spawn({
          cmd: [
            binary,
            'tunnel',
            '--no-autoupdate',
            'run',
            '--token',
            op.tunnelToken,
            '--url',
            `http://127.0.0.1:${op.port}`,
          ],
          env: deps.env,
          onStdout: () => undefined,
          onStderr: () => undefined,
        })
      } catch (error) {
        throw new CallFailureError({
          code: ECallFailure.SpawnFailed,
          message: `cloudflared could not start for port ${op.port}: ${messageOf(error)}`,
        })
      }
      const record: RunningPreview = { info: { port: op.port, pid: child.pid }, child }
      records.set(op.port, record)
      void child.exit().then(() => {
        if (records.get(op.port)?.child === child) records.delete(op.port)
      })
      return { ...record.info }
    }

    return {
      name: 'previews',
      ops: [
        defineOp({ op: 'previews.expose', run: ({ op }) => expose(op) }),
        defineOp({
          op: 'previews.stop',
          run: async ({ op }) => ({ stopped: await stopPort(op.port) }),
        }),
        defineOp({
          op: 'previews.list',
          run: () => Promise.resolve([...records.values()].map((record) => ({ ...record.info }))),
        }),
      ],
      stop: async () => {
        await Promise.all([...records.keys()].map((port) => stopPort(port)))
      },
    }
  }
