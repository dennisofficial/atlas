import { defineOp, type DaemonGroupFactory } from '../../engine'
import type { GrepMatch, GrepOp } from '../../ops'
import type { MemoryFileSystem } from '../memory-files'

const decodeLenient = (bytes: Uint8Array): string =>
  new TextDecoder('utf-8', { fatal: false }).decode(bytes)

const decodeStrict = (bytes: Uint8Array): string | null => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

const grepMemory = (args: { op: GrepOp; fs: MemoryFileSystem }): GrepMatch[] => {
  const { op, fs } = args
  fs.stat({ path: op.path })
  const pattern = new RegExp(op.pattern, op.caseInsensitive === true ? 'i' : '')
  const within = op.glob === undefined ? '**/*' : `**/${op.glob}`
  const matches: GrepMatch[] = []
  for (const file of fs.glob({ pattern: within, cwd: op.path, dot: true })) {
    const path = op.path === '/' ? `/${file}` : `${op.path}/${file}`
    if (!fs.stat({ path }).isFile) continue
    decodeLenient(fs.readBytes({ path }))
      .split('\n')
      .forEach((text, index) => {
        if (pattern.test(text)) matches.push({ path, line: index + 1, text })
      })
  }
  return op.maxResults === undefined ? matches : matches.slice(0, op.maxResults)
}

export const fakeFilesGroup =
  (args: { fs: MemoryFileSystem }): DaemonGroupFactory =>
  () => {
    const { fs } = args
    return {
      name: 'files',
      ops: [
        defineOp({ op: 'stat', run: async ({ op }) => fs.stat({ path: op.path }) }),
        defineOp({
          op: 'readFile',
          run: async ({ op }) => decodeLenient(fs.readBytes({ path: op.path })),
        }),
        defineOp({
          op: 'readBytes',
          run: async ({ op }) => Buffer.from(fs.readBytes({ path: op.path })).toString('base64'),
        }),
        defineOp({
          op: 'readTextForEdit',
          run: async ({ op }) => {
            const bytes = fs.readBytes({ path: op.path })
            return { text: decodeLenient(bytes), strict: decodeStrict(bytes) }
          },
        }),
        defineOp({
          op: 'writeFile',
          run: async ({ op }) => {
            fs.writeFile({
              path: op.path,
              content: new TextEncoder().encode(op.content),
              mode: op.mode,
            })
            return null
          },
        }),
        defineOp({
          op: 'remove',
          run: async ({ op }) => {
            fs.remove({ path: op.path })
            return null
          },
        }),
        defineOp({
          op: 'mkdir',
          run: async ({ op }) => {
            fs.mkdir({ path: op.path })
            return null
          },
        }),
        defineOp({
          op: 'rename',
          run: async ({ op }) => {
            fs.rename({ from: op.from, to: op.to })
            return null
          },
        }),
        defineOp({
          op: 'readDirectory',
          run: async ({ op }) => fs.readDirectory({ path: op.path }),
        }),
        defineOp({
          op: 'glob',
          run: async ({ op }) => fs.glob({ pattern: op.pattern, cwd: op.cwd, dot: op.dot }),
        }),
        defineOp({ op: 'grep', run: async ({ op }) => grepMemory({ op, fs }) }),
      ],
    }
  }
