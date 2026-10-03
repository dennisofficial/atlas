import { join } from 'node:path'

import { createSocketRequester } from './connection'
import { isProcessAlive, readJsonFile, readTextFile, stampIsLive } from './identity'
import {
  CONTROL_FLAG,
  controlActionSchema,
  EControlError,
  META_FILE,
  metaSchema,
  REQUEST_TIMEOUT_MS,
  TOKEN_FILE,
  type ControlAction,
  type ControlResult,
  type ShellMeta,
} from './protocol'

export { CONTROL_FLAG }

function failure({ code, message }: { code: EControlError; message: string }): ControlResult {
  return { ok: false, code, message }
}

async function loadTarget({ directory }: { directory: string }): Promise<{ meta: ShellMeta; token: string } | ControlResult> {
  const meta = await readJsonFile({ path: join(directory, META_FILE), schema: metaSchema })
  if (!meta.ok) return failure({ code: EControlError.Unreachable, message: meta.reason })
  const token = await readTextFile({ path: join(directory, TOKEN_FILE) })
  if (!token.ok) return failure({ code: EControlError.Unauthorized, message: token.reason })
  return { meta: meta.value, token: token.value.trim() }
}

export async function sendControl({
  directory,
  request,
  timeoutMs = REQUEST_TIMEOUT_MS,
}: {
  directory: string
  request: ControlAction
  timeoutMs?: number | undefined
}): Promise<ControlResult> {
  const target = await loadTarget({ directory })
  if (!('meta' in target)) return target
  const requester = createSocketRequester({
    socketPath: target.meta.socketPath,
    token: target.token,
    identity: target.meta.identity,
    timeoutMs,
  })
  try {
    const result = await requester.request({ request: request.type === 'probe' ? { type: 'heartbeat' } : request })
    if (request.type !== 'probe') return result
    return {
      ok: true,
      probe: {
        supervisorAlive: await stampIsLive({ stamp: target.meta.supervisor }),
        childAlive: isProcessAlive({ pid: target.meta.child.pid }) && await stampIsLive({ stamp: target.meta.child }),
        reachable: result.ok,
      },
    }
  } finally {
    requester.close()
  }
}

export function directTransport({ directory }: { directory: string }) {
  return ({ request }: { request: ControlAction }): Promise<ControlResult> => sendControl({ directory, request })
}

export async function runControlCommand({ args }: { args: readonly string[] }): Promise<number> {
  const [flag, directory, json] = args
  if (flag !== CONTROL_FLAG || directory === undefined || json === undefined) return 2
  let parsed: ControlAction
  try {
    parsed = controlActionSchema.parse(JSON.parse(json))
  } catch {
    return 2
  }
  process.stdout.write(`${JSON.stringify(await sendControl({ directory, request: parsed }))}\n`)
  return 0
}
