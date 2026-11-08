import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { ECallStatus } from '@dltech/atlas-protocol'

export type GhRun = { ok: true; text: string } | { ok: false; reason: string }

export const runGh = async (args: {
  ctx: Pick<PluginPodContext, 'call'>
  argv: readonly string[]
  cwd?: string | undefined
  signal?: AbortSignal | undefined
}): Promise<GhRun> => {
  const chunks: Uint8Array[] = []
  const result = await args.ctx.call(
    {
      op: 'exec',
      argv: ['gh', ...args.argv],
      ...(args.cwd === undefined ? {} : { cwd: args.cwd }),
    },
    {
      ...(args.signal === undefined ? {} : { signal: args.signal }),
      onOutput: (bytes) => {
        chunks.push(bytes)
      },
    },
  )
  const text = new TextDecoder().decode(Buffer.concat(chunks)).trim()
  if (result.status !== ECallStatus.Ok) return { ok: false, reason: result.error.message }
  if (result.op !== 'exec' || result.value.exitCode !== 0) {
    return { ok: false, reason: text.length > 0 ? text : 'gh exited with an error' }
  }
  return { ok: true, text }
}
