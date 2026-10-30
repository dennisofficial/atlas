import type { Sandbox } from '@vercel/sandbox'

import { CHANNEL_PROTOCOL_VERSION } from '../channel-wire.js'
import { SERVE_TOKEN_PATH } from '../serve-env.js'

export interface RecordedCommand {
  cmd: string
  args?: string[]
  detached?: boolean
  timeoutMs?: number
  env?: Record<string, string>
}

export interface RecordedWrite {
  path: string
  content: string | Uint8Array
  mode?: number
}

export const fakeSandbox = (args: {
  healthy: boolean
  alive?: boolean
  tokenMatches?: boolean
  waitSucceeds?: boolean
  logTail?: string
  serveVersion?: string
  stopLeavesCorpse?: boolean
  healthBody?: string
  lazyResume?: { staleSessionId: string; resumedSessionId: string }
}) => {
  const commands: RecordedCommand[] = []
  const writes: RecordedWrite[] = []
  const ops: string[] = []
  let alive = args.alive === true
  const lazyResume = args.lazyResume
  const sessionAccessor =
    lazyResume === undefined
      ? {}
      : {
          currentSession: () => ({
            sessionId:
              commands.length === 0 ? lazyResume.staleSessionId : lazyResume.resumedSessionId,
          }),
        }
  const sandbox = {
    name: 'atlas-thread-x',
    ...sessionAccessor,
    writeFiles: async (files: RecordedWrite[]) => {
      ops.push('write')
      writes.push(...files)
    },
    runCommand: async (params: RecordedCommand) => {
      ops.push('command')
      commands.push(params)
      const script = params.args?.[1] ?? ''
      if (params.detached === true) return { cmdId: 'cmd_1' }
      if (script.includes('alive=1')) {
        const version = args.serveVersion ?? ''
        const healthy = args.healthy && (args.alive !== true || alive)
        return {
          exitCode: 0,
          stdout: async () =>
            [
              `alive=${alive ? 1 : 0}`,
              'present=1',
              `version=${version}`,
              `protocol=${version === '' ? '' : String(CHANNEL_PROTOCOL_VERSION)}`,
              `token=${args.tokenMatches === false ? 0 : 1}`,
              `healthy=${healthy ? 1 : 0}`,
            ].join('\n'),
        }
      }
      if (script.startsWith('kill -0')) {
        return { exitCode: alive ? 0 : 1 }
      }
      if (script.includes('kill "$_pid"')) {
        alive = args.stopLeavesCorpse === true
        return { exitCode: 0 }
      }
      if (script.includes('kill -9 "$_pid"')) {
        alive = args.stopLeavesCorpse === true
        return { exitCode: 0, stdout: async () => '', stderr: async () => '' }
      }
      if (script.startsWith('for i in')) {
        return { exitCode: args.waitSucceeds === false ? 1 : 0 }
      }
      if (script.startsWith('mkdir ') && script.includes(SERVE_TOKEN_PATH)) {
        ops.push('write')
        writes.push({
          path: SERVE_TOKEN_PATH,
          content: params.env?.ATLAS_SERVE_TOKEN ?? '',
          mode: 0o600,
        })
        return { exitCode: 0 }
      }
      if (script.startsWith('mkdir ')) return { exitCode: 0 }
      if (script.startsWith('tail -c')) {
        return { exitCode: 0, stdout: async () => args.logTail ?? '' }
      }
      if (script.includes('/v1/health') && !script.includes('-o /dev/null')) {
        return {
          exitCode: args.healthy && (args.alive !== true || alive) ? 0 : 1,
          stdout: async () => args.healthBody ?? '',
          stderr: async () => '',
        }
      }
      return { exitCode: args.healthy && (args.alive !== true || alive) ? 0 : 1 }
    },
  }
  return { sandbox: sandbox as unknown as Sandbox, commands, writes, ops }
}

export const scriptsOf = (commands: RecordedCommand[]): string[] =>
  commands.map((command) => command.args?.[1] ?? '')

export const launchesOf = (commands: RecordedCommand[]): RecordedCommand[] =>
  commands.filter((command) => command.detached === true)
