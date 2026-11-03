import type { CallOp } from '../ops'
import type { MemoryFileSystem } from './memory-files'

export const scriptFor = (argv: readonly string[]): string => {
  const joined = argv.join(' ')
  const pipe = joined.indexOf('|')
  const effective = pipe >= 0 ? joined.slice(0, pipe) : joined
  const match = /echo\s+['"]?([^'"]*?)['"]?\s*$/.exec(effective)
  if (match?.[1] !== undefined) return `${match[1]}\n`
  return ''
}

export const fakeSleepMs = (argv: readonly string[]): number => {
  const match = /sleep\s+([\d.]+)/.exec(argv.join(' '))
  if (match?.[1] === undefined) return 0
  return Math.ceil(Number(match[1]) * 1000)
}

const runFileOp = (args: { op: CallOp; fs: MemoryFileSystem }): unknown => {
  const { op, fs } = args
  if (op.op === 'writeFile') {
    fs.writeFile({ path: op.path, content: new TextEncoder().encode(op.content), mode: op.mode })
    return { wrote: op.path }
  }
  if (op.op === 'readFile') return new TextDecoder().decode(fs.readBytes({ path: op.path }))
  if (op.op === 'readBytes') return Buffer.from(fs.readBytes({ path: op.path })).toString('base64')
  if (op.op === 'stat') return fs.stat({ path: op.path })
  if (op.op === 'mkdir') {
    fs.mkdir({ path: op.path })
    return { created: op.path }
  }
  if (op.op === 'remove') {
    fs.remove({ path: op.path })
    return { removed: op.path }
  }
  if (op.op === 'rename') {
    fs.rename({ from: op.from, to: op.to })
    return { renamed: [op.from, op.to] }
  }
  if (op.op === 'readDirectory') return fs.readDirectory({ path: op.path })
  if (op.op === 'glob') return fs.glob({ pattern: op.pattern, cwd: op.cwd, dot: op.dot })
  if (op.op === 'grep') {
    const pattern = new RegExp(op.pattern, op.caseInsensitive === true ? 'i' : '')
    const matches: { path: string; line: number; text: string }[] = []
    const within = op.glob === undefined ? '**/*' : `**/${op.glob}`
    for (const file of fs.glob({ pattern: within, cwd: op.path, dot: true })) {
      const path = op.path === '/' ? `/${file}` : `${op.path}/${file}`
      let content: string
      try {
        content = new TextDecoder().decode(fs.readBytes({ path }))
      } catch {
        continue
      }
      content.split('\n').forEach((text, index) => {
        if (pattern.test(text)) matches.push({ path, line: index + 1, text })
      })
      if (op.maxResults !== undefined && matches.length >= op.maxResults) break
    }
    return op.maxResults === undefined ? matches : matches.slice(0, op.maxResults)
  }
  if (op.op === 'readTextForEdit') {
    const bytes = fs.readBytes({ path: op.path })
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
    let strict: string | null = null
    try {
      strict = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      strict = null
    }
    return { text, strict }
  }
  throw new Error(`unsupported op: ${op.op}`)
}

export const runFakeOp = async (args: {
  op: CallOp
  fs: MemoryFileSystem
  countSpawn(): void
  killed(): boolean
  finished: Promise<void>
  onChunk(bytes: Uint8Array): void
}): Promise<unknown> => {
  const op = args.op
  if (op.op !== 'exec') return runFileOp({ op, fs: args.fs })
  args.countSpawn()
  const joined = op.argv.join(' ')
  const base64Match = /printf '%s' '([A-Za-z0-9+/=]+)' \| base64 -d > (\S+)/.exec(joined)
  if (base64Match?.[1] !== undefined && base64Match[2] !== undefined) {
    args.fs.writeFile({
      path: base64Match[2],
      content: new Uint8Array(Buffer.from(base64Match[1], 'base64')),
    })
    return { exitCode: 0, output: '' }
  }
  const text = scriptFor(op.argv)
  if (text !== '') {
    args.onChunk(new TextEncoder().encode(text))
    return { exitCode: 0, output: text }
  }
  const sleepMs = fakeSleepMs(op.argv)
  if (sleepMs > 0) {
    await Promise.race([args.finished, new Promise((resolve) => setTimeout(resolve, sleepMs))])
    if (args.killed()) return { exitCode: 143, output: '', error: 'cancelled' }
    return { exitCode: 0, output: '' }
  }
  return { exitCode: 0, output: '' }
}
