import { toThreadId, type ToolOutcome } from '@dltech/atlas-core'
import {
  EMPTY_CLASSIFIER,
  EMPTY_CREW,
  EMPTY_MESSAGES,
  EMPTY_MCP_CONTROL,
  EMPTY_POD_RESOURCES,
  EMPTY_ROUTINES,
  EMPTY_SESSIONS,
  EMPTY_SUBSCRIPTIONS,
  EMPTY_WORKTREES,
  UNVERSIONED_SETTINGS,
  type PluginPodContext,
} from '@dltech/atlas-plugin-sdk'
import { ECallFailure, ECallStatus, type CallOp, type CallResult } from '@dltech/atlas-protocol'

import type { GenerateOutcome } from '../generate'
import { ImageGenerateTool, type ImageGenerateDeps } from '../image-generate-tool'

export const SESSION_DIR = '/atlas/home/sessions/ses_42'

export const AT = new Date('2026-11-23T10:11:12.000Z')

const unsupported = (): never => {
  throw new Error('not part of this spec')
}

export const pngOf = (args: { width: number; height: number; byteLength?: number }): Uint8Array => {
  const bytes = new Uint8Array(args.byteLength ?? 64)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  bytes.set([0, 0, 0, 13], 8)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, args.width)
  view.setUint32(20, args.height)
  return bytes
}

export const gifOf = (args: { width: number; height: number }): Uint8Array => {
  const bytes = new Uint8Array(16)
  bytes.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0)
  const view = new DataView(bytes.buffer)
  view.setUint16(6, args.width, true)
  view.setUint16(8, args.height, true)
  return bytes
}

export type Rig = {
  ctx: PluginPodContext
  files: Map<string, Uint8Array>
  made: string[]
}

export const rigOf = (
  args: {
    apiKey?: string | undefined
    imageModel?: string | undefined
    files?: Map<string, Uint8Array>
  } = {},
): Rig => {
  const files = args.files ?? new Map<string, Uint8Array>()
  const made: string[] = []
  const apiKey = 'apiKey' in args ? args.apiKey : 'vck_test'
  const imageModel = args.imageModel

  const call = async (op: CallOp): Promise<CallResult> => {
    if (op.op === 'readBytes') {
      const bytes = files.get(op.path)
      if (bytes === undefined) {
        return {
          status: ECallStatus.Failed,
          op: 'readBytes',
          error: { code: ECallFailure.NotFound, message: `${op.path} does not exist` },
        }
      }
      return {
        status: ECallStatus.Ok,
        op: 'readBytes',
        value: Buffer.from(bytes).toString('base64'),
      }
    }

    if (op.op === 'mkdir') {
      made.push(op.path)
      return { status: ECallStatus.Ok, op: 'mkdir', value: null }
    }

    if (op.op === 'writeFile') {
      files.set(op.path, Buffer.from(op.content, 'base64'))
      return { status: ECallStatus.Ok, op: 'writeFile', value: null }
    }

    return {
      status: ECallStatus.Failed,
      op: op.op,
      error: { code: ECallFailure.InvalidInput, message: `this rig has no ${op.op}` },
    }
  }

  const ctx: PluginPodContext = {
    sessionId: 'ses_42',
    control: {
      settingsVersions: async () => UNVERSIONED_SETTINGS,
      exposePort: unsupported,
      memory: {} as never,
      mcp: EMPTY_MCP_CONTROL,
      webSearch: { config: async () => ({ backend: undefined, key: undefined }) },
      gateway: { apiKey: async () => apiKey, imageModel: async () => imageModel },
      routines: EMPTY_ROUTINES,
      subscriptions: EMPTY_SUBSCRIPTIONS,
    },
    resources: EMPTY_POD_RESOURCES,
    crew: EMPTY_CREW,
    messages: EMPTY_MESSAGES,
    classifier: EMPTY_CLASSIFIER,
    sessions: EMPTY_SESSIONS,
    worktrees: EMPTY_WORKTREES,
    notify: unsupported,
    append: unsupported,
    events: () => [],
    call,
    live: () => undefined,
    onDaemonEvent: () => () => undefined,
    log: () => undefined,
    env: async () => ({ ATLAS_SESSION_DIR: SESSION_DIR }),
  }

  return { ctx, files, made }
}

export const toolOf = (args: { rig: Rig; deps?: ImageGenerateDeps }): ImageGenerateTool =>
  new ImageGenerateTool(args.rig.ctx, { now: () => AT, ...args.deps })

export const liveOutcomeOf = (outcome: ToolOutcome): Extract<ToolOutcome, { ok: true }> => {
  if (!outcome.ok) throw new Error(`expected a result, got: ${outcome.reason}`)
  return outcome
}

export const invoke = (
  tool: ImageGenerateTool,
  input: Record<string, unknown>,
): Promise<ToolOutcome> =>
  tool.invoke({
    input,
    signal: new AbortController().signal,
    idempotencyKey: 'key-1',
    projectDirectory: '/work/repo',
    activeWorktree: undefined,
    threadId: toThreadId('thr_1'),
  })

export const generatedOf =
  (bytes: Uint8Array, mediaType = 'image/png') =>
  async (): Promise<GenerateOutcome> => ({
    ok: true,
    bytes,
    mediaType,
  })
