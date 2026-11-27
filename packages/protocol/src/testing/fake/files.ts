import { defineOp, type DaemonGroupFactory } from '../../engine'
import {
  DIGEST_HEAD_BYTES,
  type DigestFileOp,
  type FetchToFileOp,
  type GrepMatch,
  type GrepOp,
  type PutFileOp,
} from '../../ops'
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

const fetchIntoMemory = async (args: {
  op: FetchToFileOp
  fs: MemoryFileSystem
  signal: AbortSignal
}): Promise<void> => {
  const { op, fs, signal } = args
  if (fs.exists({ path: op.path }) && fs.stat({ path: op.path }).isFile) return
  const response = await fetch(op.url, { signal })
  if (!response.ok || response.body === null) {
    throw new Error(`fetching ${op.path} failed with status ${response.status}`)
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.length !== op.size) {
    throw Object.assign(new Error(`fetched ${bytes.length} bytes, expected ${op.size}`), {
      code: 'EINVAL',
    })
  }
  fs.writeFile({ path: op.path, content: bytes })
}

const putFromMemory = async (args: {
  op: PutFileOp
  fs: MemoryFileSystem
  signal: AbortSignal
}): Promise<{ sha256: string; size: number }> => {
  const { op, fs, signal } = args
  const bytes = fs.readBytes({ path: op.path })
  const response = await fetch(op.url, {
    method: 'PUT',
    body: bytes,
    signal,
    headers: {
      'content-type': 'application/octet-stream',
      'content-length': String(bytes.length),
    },
  })
  if (!response.ok) {
    throw new Error(`putting the file failed with status ${response.status}`)
  }
  return { sha256: new Bun.CryptoHasher('sha256').update(bytes).digest('hex'), size: bytes.length }
}

const digestOf = (args: {
  op: DigestFileOp
  fs: MemoryFileSystem
}): {
  sha256: string
  size: number
  head: string
} => {
  const bytes = args.fs.readBytes({ path: args.op.path })
  return {
    sha256: new Bun.CryptoHasher('sha256').update(bytes).digest('hex'),
    size: bytes.length,
    head: Buffer.from(bytes.subarray(0, DIGEST_HEAD_BYTES)).toString('base64'),
  }
}

const grepMemory = (args: { op: GrepOp; fs: MemoryFileSystem }): GrepMatch[] => {
  const { op, fs } = args
  const target = fs.stat({ path: op.path })
  const pattern = new RegExp(op.pattern, op.caseInsensitive === true ? 'i' : '')
  const within = op.glob === undefined ? '**/*' : `**/${op.glob}`
  const files = target.isFile
    ? [op.path]
    : fs
        .glob({ pattern: within, cwd: op.path, dot: true })
        .map((file) => (op.path === '/' ? `/${file}` : `${op.path}/${file}`))
  const matches: GrepMatch[] = []
  for (const path of files) {
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
          op: 'readLink',
          run: async ({ op }) => {
            fs.stat({ path: op.path })
            return null
          },
        }),
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
              content:
                op.encoding === 'base64'
                  ? new Uint8Array(Buffer.from(op.content, 'base64'))
                  : new TextEncoder().encode(op.content),
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
          op: 'fetchToFile',
          run: async ({ op, ctx }) => {
            await fetchIntoMemory({ op, fs, signal: ctx.signal })
            return null
          },
        }),
        defineOp({
          op: 'digestFile',
          run: async ({ op }) => digestOf({ op, fs }),
        }),
        defineOp({
          op: 'putFile',
          run: async ({ op, ctx }) => await putFromMemory({ op, fs, signal: ctx.signal }),
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
