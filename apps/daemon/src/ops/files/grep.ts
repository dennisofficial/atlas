import { CallFailureError, ECallFailure, type GrepMatch, type GrepOp } from '@dltech/atlas-protocol'
import { z } from 'zod'

import { ManagedProcess } from '../../process/managed'

const RG_NO_MATCH = 1

const rgMatchSchema = z.object({
  type: z.literal('match'),
  data: z.object({
    path: z.object({ text: z.string() }),
    line_number: z.number().int().min(1),
    lines: z.object({ text: z.string() }).optional(),
    submatches: z.array(z.object({ start: z.number().int().min(0) })).optional(),
  }),
})

const matchesOf = (args: { stdout: string; maxResults: number | undefined }): GrepMatch[] => {
  const matches: GrepMatch[] = []
  for (const line of args.stdout.split('\n')) {
    if (args.maxResults !== undefined && matches.length >= args.maxResults) break
    if (line === '') continue
    let json: unknown
    try {
      json = JSON.parse(line)
    } catch {
      continue
    }
    const parsed = rgMatchSchema.safeParse(json)
    if (!parsed.success) continue
    const { data } = parsed.data
    const first = data.submatches?.[0]
    matches.push({
      path: data.path.text,
      line: data.line_number,
      ...(first === undefined ? {} : { column: first.start + 1 }),
      text: (data.lines?.text ?? '').replace(/\r?\n$/, ''),
    })
  }
  return matches
}

export const grepRipgrep = async (args: {
  op: GrepOp
  rg: string
  env: Record<string, string | undefined>
  signal: AbortSignal
}): Promise<GrepMatch[]> => {
  const { op } = args
  const argv = [args.rg, '--json', '--no-config']
  if (op.caseInsensitive === true) argv.push('--ignore-case')
  if (op.glob !== undefined) argv.push('--glob', op.glob)
  argv.push('--', op.pattern, op.path)

  const decoder = new TextDecoder()
  let stdout = ''
  let stderr = ''
  const child = ManagedProcess.spawn({
    cmd: argv,
    env: args.env,
    onStdout: (bytes) => {
      stdout += decoder.decode(bytes, { stream: true })
    },
    onStderr: (bytes) => {
      stderr += new TextDecoder().decode(bytes)
    },
  })
  const handleAbort = (): void => child.kill()
  args.signal.addEventListener('abort', handleAbort, { once: true })
  try {
    const exit = await child.exit()
    if (args.signal.aborted) {
      throw new CallFailureError({ code: ECallFailure.Internal, message: 'grep cancelled' })
    }
    if (exit.exitCode !== 0 && exit.exitCode !== RG_NO_MATCH) {
      const missing = /No such file or directory/.test(stderr)
      throw new CallFailureError({
        code: missing ? ECallFailure.NotFound : ECallFailure.Internal,
        message: stderr.trim() || `rg exited ${exit.exitCode ?? exit.signal}`,
      })
    }
    return matchesOf({ stdout, maxResults: op.maxResults })
  } finally {
    args.signal.removeEventListener('abort', handleAbort)
  }
}
