import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'

import type { DirectoryEntry, StatResult } from '@dltech/atlas-protocol'

import type { OpRegistry } from '../registry'
import { grepRipgrep } from './grep'

const statPath = async (args: { path: string }): Promise<StatResult> => {
  const info = await stat(args.path)
  return {
    size: info.size,
    mode: info.mode,
    mtimeMs: info.mtimeMs,
    isFile: info.isFile(),
    isDirectory: info.isDirectory(),
  }
}

const readTextForEditFile = async (args: {
  path: string
}): Promise<{ text: string; strict: string | null }> => {
  const bytes = new Uint8Array(await readFile(args.path))
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  let strict: string | null = null
  try {
    strict = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    strict = null
  }
  return { text, strict }
}

const globPaths = async (args: {
  pattern: string
  cwd: string
  dot?: boolean | undefined
}): Promise<string[]> => {
  const glob = new Bun.Glob(args.pattern)
  const found: string[] = []
  const scanOptions = args.dot === undefined ? {} : { dot: args.dot }
  for await (const path of glob.scan({ cwd: args.cwd, onlyFiles: false, ...scanOptions })) {
    found.push(path)
  }
  return found
}

const readDirectoryPath = async (args: { path: string }): Promise<DirectoryEntry[]> => {
  const entries = await readdir(args.path, { withFileTypes: true })
  return entries.map((entry) => ({
    name: entry.name,
    isFile: entry.isFile(),
    isDirectory: entry.isDirectory(),
  }))
}

export const filesOps: OpRegistry = {
  stat: {
    streams: false,
    run: async ({ op }) => {
      if (op.op !== 'stat') throw new Error('stat handler received another op')
      return await statPath({ path: op.path })
    },
  },
  readFile: {
    streams: false,
    run: async ({ op }) => {
      if (op.op !== 'readFile') throw new Error('readFile handler received another op')
      return await readFile(op.path, 'utf8')
    },
  },
  readBytes: {
    streams: false,
    run: async ({ op }) => {
      if (op.op !== 'readBytes') throw new Error('readBytes handler received another op')
      const bytes = new Uint8Array(await readFile(op.path))
      return Buffer.from(bytes).toString('base64')
    },
  },
  readTextForEdit: {
    streams: false,
    run: async ({ op }) => {
      if (op.op !== 'readTextForEdit') {
        throw new Error('readTextForEdit handler received another op')
      }
      return await readTextForEditFile({ path: op.path })
    },
  },
  writeFile: {
    streams: false,
    run: async ({ op }) => {
      if (op.op !== 'writeFile') throw new Error('writeFile handler received another op')
      await writeFile(
        op.path,
        op.content,
        op.mode === undefined ? 'utf8' : { encoding: 'utf8', mode: op.mode },
      )
      return { wrote: op.path }
    },
  },
  remove: {
    streams: false,
    run: async ({ op }) => {
      if (op.op !== 'remove') throw new Error('remove handler received another op')
      await rm(op.path, { recursive: true, force: true })
      return { removed: op.path }
    },
  },
  mkdir: {
    streams: false,
    run: async ({ op }) => {
      if (op.op !== 'mkdir') throw new Error('mkdir handler received another op')
      await mkdir(op.path, { recursive: true })
      return { created: op.path }
    },
  },
  rename: {
    streams: false,
    run: async ({ op }) => {
      if (op.op !== 'rename') throw new Error('rename handler received another op')
      await rename(op.from, op.to)
      return { renamed: [op.from, op.to] }
    },
  },
  readDirectory: {
    streams: false,
    run: async ({ op }) => {
      if (op.op !== 'readDirectory') {
        throw new Error('readDirectory handler received another op')
      }
      return await readDirectoryPath({ path: op.path })
    },
  },
  glob: {
    streams: false,
    run: async ({ op }) => {
      if (op.op !== 'glob') throw new Error('glob handler received another op')
      return await globPaths({ pattern: op.pattern, cwd: op.cwd, dot: op.dot })
    },
  },
  grep: {
    streams: false,
    run: async ({ op }) => {
      if (op.op !== 'grep') throw new Error('grep handler received another op')
      return await grepRipgrep(op)
    },
  },
}
