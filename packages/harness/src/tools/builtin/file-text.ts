import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'

import { z } from 'zod'

export const filePathSchema = z.string().min(1)

export const pathEnvironmentNote =
  'A path may reference environment variables such as $TMPDIR and may start with ~; both expand against the environment before resolution, and a variable that is not set is an error rather than a literal directory name.'

export type ToolPathResolution =
  | { ok: true; path: string; anchored: boolean }
  | { ok: false; reason: string }

export type EnvExpansion = { ok: true; path: string } | { ok: false; reason: string }

const ENV_REFERENCE = /\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g

export function expandPathEnvironment(args: {
  path: string
  env?: NodeJS.ProcessEnv
}): EnvExpansion {
  const env = args.env ?? process.env
  let path = args.path

  if (path === '~' || path.startsWith('~/')) {
    path = (env['HOME'] ?? homedir()) + path.slice(1)
  }

  const unset = new Set<string>()
  path = path.replace(ENV_REFERENCE, (reference, braced: string | undefined, bare: string | undefined) => {
    const name = braced ?? bare ?? ''
    const value = env[name]
    if (value === undefined) {
      unset.add(name)
      return reference
    }
    return value
  })

  if (unset.size > 0) {
    const names = [...unset].map((name) => `$${name}`)
    const verb = unset.size === 1 ? 'is' : 'are'
    return {
      ok: false,
      reason: `The path ${args.path} references ${names.join(' and ')}, which ${verb} not set in the agent's environment. Spell the path out, or expand it through the bash tool instead.`,
    }
  }

  return { ok: true, path }
}

export function resolveToolPath(args: {
  projectDirectory: string
  path: string
  env?: NodeJS.ProcessEnv
}): ToolPathResolution {
  const expanded = expandPathEnvironment({ path: args.path, ...(args.env === undefined ? {} : { env: args.env }) })
  if (!expanded.ok) return expanded
  if (isAbsolute(expanded.path)) return { ok: true, path: resolve(expanded.path), anchored: false }
  return { ok: true, path: resolve(args.projectDirectory, expanded.path), anchored: true }
}

export enum ELineEnding {
  Lf = 'lf',
  Crlf = 'crlf',
}

export function detectLineEnding(content: string): ELineEnding {
  let crlf = 0
  let lf = 0

  for (let index = 0; index < content.length; index += 1) {
    if (content[index] !== '\n') continue
    if (index > 0 && content[index - 1] === '\r') crlf += 1
    else lf += 1
  }

  return crlf > lf ? ELineEnding.Crlf : ELineEnding.Lf
}

export const toLf = (content: string): string => content.replaceAll('\r\n', '\n')

export function withLineEnding(args: { content: string; ending: ELineEnding }): string {
  if (args.ending === ELineEnding.Lf) return args.content
  return toLf(args.content).split('\n').join('\r\n')
}

export function splitLines(content: string): string[] {
  if (content === '') return []

  const lines = content.split('\n')
  if (lines.at(-1) === '') lines.pop()

  return lines
}

export const isNewlineTerminated = (content: string): boolean =>
  content === '' || content.endsWith('\n')

const PATTERN_METACHARACTERS = /[.*+?^${}()|[\]\\]/g

export function lineEndingAgnosticPattern(target: string): string {
  return toLf(target).replace(PATTERN_METACHARACTERS, '\\$&').replaceAll('\n', '\\r?\\n')
}

export function endingOfRegion(args: { region: string; fallback: ELineEnding }): ELineEnding {
  if (args.region.includes('\r\n')) return ELineEnding.Crlf
  if (args.region.includes('\n')) return ELineEnding.Lf

  return args.fallback
}
