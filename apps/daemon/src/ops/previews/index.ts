import { existsSync } from 'node:fs'

import {
  CallFailureError,
  ECallFailure,
  type PreviewInfo,
  type PreviewsExposeOp,
} from '@dltech/atlas-protocol'
import { type DaemonGroupFactory, defineOp } from '@dltech/atlas-protocol/engine'

import { ManagedProcess, type ManagedExit } from '../../process/managed'
import { CLOUDFLARED_PATH, PREVIEW_READY_TIMEOUT_MS, type DaemonOpsDeps } from '../deps'

const REGISTERED_MARKER = 'Registered tunnel connection'
const OUTPUT_TAIL_CHARS = 2_000
const READY_POLL_MS = 100
const decoder = new TextDecoder()

type RunningPreview = { info: PreviewInfo; child: ManagedProcess }

type Readiness =
  | { kind: 'registered' }
  | { kind: 'exited'; exit: ManagedExit }
  | { kind: 'timeout' }

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const tailOf = (output: string): string =>
  output === '' ? '(cloudflared printed nothing)' : output.slice(-OUTPUT_TAIL_CHARS)

const exitLabelOf = (exit: ManagedExit): string =>
  exit.exitCode !== null ? `code ${exit.exitCode}` : `signal ${exit.signal ?? 'unknown'}`

const waitForRegistration = (args: {
  child: ManagedProcess
  output: () => string
  timeoutMs: number
}): Promise<Readiness> =>
  new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (readiness: Readiness): void => {
      if (timer !== undefined) clearTimeout(timer)
      resolve(readiness)
    }
    const deadline = Date.now() + args.timeoutMs
    const check = (): void => {
      if (args.output().includes(REGISTERED_MARKER)) return finish({ kind: 'registered' })
      if (Date.now() >= deadline) return finish({ kind: 'timeout' })
      timer = setTimeout(check, READY_POLL_MS)
    }
    void args.child.exit().then((exit) => finish({ kind: 'exited', exit }))
    check()
  })

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
      const binary = deps.cloudflaredPath ?? CLOUDFLARED_PATH
      if (!existsSync(binary)) {
        throw new CallFailureError({
          code: ECallFailure.SpawnFailed,
          message: `this pod has no cloudflared binary, so port ${op.port} cannot be published`,
        })
      }
      await stopPort(op.port)
      let output = ''
      const capture = (bytes: Uint8Array): void => {
        output = (output + decoder.decode(bytes, { stream: true })).slice(-OUTPUT_TAIL_CHARS)
      }
      let child: ManagedProcess
      try {
        child = ManagedProcess.spawn({
          cmd: [binary, 'tunnel', '--no-autoupdate', 'run', '--url', `http://127.0.0.1:${op.port}`],
          env: { ...deps.env, TUNNEL_TOKEN: op.tunnelToken },
          onStdout: capture,
          onStderr: capture,
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
      const timeoutMs = deps.previewReadyTimeoutMs ?? PREVIEW_READY_TIMEOUT_MS
      const readiness = await waitForRegistration({
        child,
        output: () => output,
        timeoutMs,
      })
      if (readiness.kind === 'registered') return { ...record.info }
      if (records.get(op.port)?.child === child) records.delete(op.port)
      if (readiness.kind === 'exited') {
        throw new CallFailureError({
          code: ECallFailure.SpawnFailed,
          message: `cloudflared for port ${op.port} exited with ${exitLabelOf(readiness.exit)} before its tunnel connected; output: ${tailOf(output)}`,
        })
      }
      child.kill()
      throw new CallFailureError({
        code: ECallFailure.SpawnFailed,
        message: `cloudflared for port ${op.port} did not register a tunnel connection within ${timeoutMs} ms; output: ${tailOf(output)}`,
      })
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
