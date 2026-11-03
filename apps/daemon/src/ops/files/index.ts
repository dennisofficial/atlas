import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'

import { type DaemonGroupFactory, defineOp } from '@dltech/atlas-protocol/engine'

import { type DaemonOpsDeps, ripgrepOf } from '../deps'
import { grepRipgrep } from './grep'

const decodeStrict = (bytes: Uint8Array): string | null => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

const globPaths = async (args: {
  pattern: string
  cwd: string
  dot?: boolean | undefined
}): Promise<string[]> => {
  await stat(args.cwd)
  const found: string[] = []
  const glob = new Bun.Glob(args.pattern)
  for await (const path of glob.scan({ cwd: args.cwd, onlyFiles: false, dot: args.dot ?? false })) {
    found.push(path)
  }
  return found.sort()
}

export const filesGroup =
  (deps: DaemonOpsDeps): DaemonGroupFactory =>
  () => ({
    name: 'files',
    ops: [
      defineOp({
        op: 'stat',
        run: async ({ op }) => {
          const info = await stat(op.path)
          return {
            size: info.size,
            mode: info.mode,
            mtimeMs: info.mtimeMs,
            isFile: info.isFile(),
            isDirectory: info.isDirectory(),
          }
        },
      }),
      defineOp({ op: 'readFile', run: async ({ op }) => await readFile(op.path, 'utf8') }),
      defineOp({
        op: 'readBytes',
        run: async ({ op }) => Buffer.from(await readFile(op.path)).toString('base64'),
      }),
      defineOp({
        op: 'readTextForEdit',
        run: async ({ op }) => {
          const bytes = new Uint8Array(await readFile(op.path))
          return {
            text: new TextDecoder('utf-8', { fatal: false }).decode(bytes),
            strict: decodeStrict(bytes),
          }
        },
      }),
      defineOp({
        op: 'writeFile',
        run: async ({ op }) => {
          await writeFile(op.path, op.content, {
            encoding: 'utf8',
            ...(op.mode === undefined ? {} : { mode: op.mode }),
          })
          return null
        },
      }),
      defineOp({
        op: 'remove',
        run: async ({ op }) => {
          await rm(op.path, { recursive: true, force: true })
          return null
        },
      }),
      defineOp({
        op: 'mkdir',
        run: async ({ op }) => {
          await mkdir(op.path, { recursive: true })
          return null
        },
      }),
      defineOp({
        op: 'rename',
        run: async ({ op }) => {
          await rename(op.from, op.to)
          return null
        },
      }),
      defineOp({
        op: 'readDirectory',
        run: async ({ op }) => {
          const entries = await readdir(op.path, { withFileTypes: true })
          return entries.map((entry) => ({
            name: entry.name,
            isFile: entry.isFile(),
            isDirectory: entry.isDirectory(),
          }))
        },
      }),
      defineOp({
        op: 'glob',
        run: async ({ op }) => await globPaths({ pattern: op.pattern, cwd: op.cwd, dot: op.dot }),
      }),
      defineOp({
        op: 'grep',
        run: async ({ op, ctx }) =>
          await grepRipgrep({ op, rg: ripgrepOf(deps), env: deps.env, signal: ctx.signal }),
      }),
    ],
  })
