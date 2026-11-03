import type { GrepMatch } from '@dltech/atlas-protocol'

export const grepRipgrep = async (args: {
  pattern: string
  path: string
  glob?: string | undefined
  caseInsensitive?: boolean | undefined
  maxResults?: number | undefined
}): Promise<GrepMatch[]> => {
  const argv = ['rg', '--json', '--max-count', '1']
  if (args.caseInsensitive === true) argv.push('--ignore-case')
  if (args.glob !== undefined) argv.push('--glob', args.glob)
  if (args.maxResults !== undefined) argv.push('--max-count', String(args.maxResults))
  argv.push('--', args.pattern, args.path)

  const child = Bun.spawn(argv, { stdout: 'pipe', stderr: 'pipe' })
  const output = await new Response(child.stdout).text()
  await child.exited

  const matches: GrepMatch[] = []
  for (const line of output.split('\n')) {
    if (line === '') continue
    let parsed: { type?: string; data?: unknown }
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (parsed.type !== 'match') continue
    const data = parsed.data as {
      path?: { text?: string }
      line_number?: number
      lines?: { text?: string }
      submatches?: { start?: number }[]
    }
    if (data.path?.text === undefined || data.line_number === undefined) continue
    const first = data.submatches?.[0]
    matches.push({
      path: data.path.text,
      line: data.line_number,
      ...(first?.start === undefined ? {} : { column: first.start + 1 }),
      text: (data.lines?.text ?? '').replace(/\n$/, ''),
    })
    if (args.maxResults !== undefined && matches.length >= args.maxResults) break
  }
  return matches
}
