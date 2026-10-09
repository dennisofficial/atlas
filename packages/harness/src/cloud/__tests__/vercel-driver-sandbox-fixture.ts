import type { Sandbox } from '@vercel/sandbox'

import { CHANNEL_PROTOCOL_VERSION } from '../channel-wire'
import { rotationReceipt } from './rotation-fixture'

export const PINNED_VERSION = '1.19.2'

export enum ERecordedCallKind {
  Command = 'command',
  Write = 'write',
}

type RecordedWrite = { path: string; content: Uint8Array | string; mode?: number }

type FakeSandboxExtras = {
  readonly commands: readonly string[]
  readonly written: readonly RecordedWrite[]
  readonly updates: readonly number[][]
  readonly resourceUpdates: readonly number[]
  readonly stopped: boolean
  readonly deleted: boolean
}

export type FakeSandbox = Sandbox & FakeSandboxExtras

export type RecordedCall =
  | { kind: ERecordedCallKind.Command; script: string }
  | { kind: ERecordedCallKind.Write; path: string }

export const fakeSandbox = (
  args: {
    status?: string
    routes?: number[]
    vcpus?: number
    memoryMb?: number
    installedVersion?: string
    installedProtocol?: string
    drainStatus?: string
    versionReadFails?: boolean
    healthy?: boolean
    alive?: boolean
    calls?: RecordedCall[]
  } = {},
): FakeSandbox => {
  const commands: string[] = []
  const written: RecordedWrite[] = []
  const updates: number[][] = []
  const resourceUpdates: number[] = []
  const calls = args.calls
  const routedPorts = [...(args.routes ?? [3000])]
  let stopped = false
  let deleted = false
  let preparedReceipt = ''

  const base = {
    name: 'atlas-thread-x',
    status: args.status ?? 'running',
    vcpus: args.vcpus,
    memory: args.memoryMb,
    routes: (args.routes ?? [3000]).map((port) => ({ port, subdomain: `sb-${port}` })),
    currentSession: () => ({ sessionId: 'session-1' }),
    domain: (port: number) => {
      const status = args.status ?? 'running'
      const routable = status === 'running' || status === 'pending' || status === 'stopped'
      if (!routedPorts.includes(port) || !routable) {
        throw new Error('no route')
      }
      return `https://sb-${port}.vercel.run`
    },
    runCommand: async (params: { cmd: string; args?: string[] }) => {
      const script = params.args?.[1] ?? params.cmd
      commands.push(script)
      calls?.push({ kind: ERecordedCallKind.Command, script })
      if (script.startsWith('rm -f'))
        return { exitCode: 0, stdout: async () => '', stderr: async () => '' }
      if (script.startsWith('kill -0')) {
        return { exitCode: args.alive === true ? 0 : 1 }
      }
      if (script.startsWith('[ ! -s')) return { exitCode: 0 }
      if (script.includes('sandbox-rotation.json')) {
        return { exitCode: 0, stdout: async () => preparedReceipt, stderr: async () => '' }
      }
      if (script.includes('/v1/health') && !script.includes('-o /dev/null')) {
        return {
          exitCode: 0,
          stdout: async () => '{"rotationPreparationVersion":1,"sandboxSessionId":"session-1"}',
          stderr: async () => '',
        }
      }
      if (script.includes('/v1/drain')) {
        const status = args.drainStatus ?? '200'
        const receipt = rotationReceipt()
        if (status === '200') preparedReceipt = JSON.stringify(receipt)
        return {
          exitCode: 0,
          stdout: async () => `${JSON.stringify({ ok: true, prepared: true, receipt })}\n${status}`,
          stderr: async () => '',
        }
      }
      const isVersionRead = script.includes('.version')
      if (isVersionRead) {
        if (args.versionReadFails) throw new Error('runCommand unavailable')
        const protocol = args.installedProtocol ?? String(CHANNEL_PROTOCOL_VERSION)
        return {
          exitCode: 0,
          stdout: async () => `${args.installedVersion ?? PINNED_VERSION}\n${protocol}\n`,
          stderr: async () => '',
        }
      }
      if (script.startsWith('for i in')) return { exitCode: 0 }
      if (script.startsWith('mkdir ')) return { exitCode: 0 }
      if (script.startsWith('tail -c'))
        return { exitCode: 0, stdout: async () => '', stderr: async () => '' }
      const healthy = args.healthy ?? true
      return { exitCode: healthy ? 0 : 1, stderr: async () => '' }
    },
    writeFiles: async (files: RecordedWrite[]) => {
      written.push(...files)
      files.forEach((file) => calls?.push({ kind: ERecordedCallKind.Write, path: file.path }))
    },
    update: async (params: { ports?: number[]; resources?: { vcpus?: number } }) => {
      if (params.ports !== undefined) {
        updates.push(params.ports)
        routedPorts.splice(0, routedPorts.length, ...params.ports)
      }
      if (params.resources?.vcpus !== undefined) resourceUpdates.push(params.resources.vcpus)
    },
    stop: async () => {
      stopped = true
    },
    delete: async () => {
      deleted = true
    },
  }

  const sandbox = base as unknown as FakeSandbox
  Object.defineProperties(sandbox, {
    commands: { get: () => commands },
    written: { get: () => written },
    updates: { get: () => updates },
    resourceUpdates: { get: () => resourceUpdates },
    stopped: { get: () => stopped },
    deleted: { get: () => deleted },
  })
  return sandbox
}
