import type { ArtifactSpec } from './spec'

const HARD_EXCLUDED_DIRECTORIES: readonly string[] = [
  '.git',
  'node_modules',
  '.venv',
  '__pycache__',
]

const ENV_PREFIX = '.env'

const ENV_ALLOWED = '.env.example'

const GLOB_RESERVED = new Set(['.', '+', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\'])

const NEVER = /$^/

export const HARD_EXCLUDED: readonly string[] = [...HARD_EXCLUDED_DIRECTORIES, `${ENV_PREFIX}*`]

export type SelectionPolicy = {
  hardExcluded: (path: string) => boolean
  forceIncluded: (path: string) => boolean
  forceExcluded: (path: string) => boolean
}

const isHardExcludedName = (name: string): boolean => {
  if (HARD_EXCLUDED_DIRECTORIES.includes(name)) return true
  return name.startsWith(ENV_PREFIX) && name !== ENV_ALLOWED
}

export function isHardExcluded(args: { path: string }): boolean {
  if (args.path.length === 0) return true
  if (args.path.includes('\0')) return true
  if (args.path.startsWith('/') || args.path.includes('\\')) return true
  return args.path
    .split('/')
    .some((segment) => segment === '.' || segment === '..' || isHardExcludedName(segment))
}

const compileGlob = (glob: string): RegExp => {
  const trimmed = glob.trim().replace(/^\.\//, '')
  const rootAnchored = trimmed.startsWith('/')
  const body = trimmed.replace(/^\/+/, '').replace(/\/+$/, '')
  if (body.length === 0) return NEVER
  let source = ''
  for (let index = 0; index < body.length; index++) {
    const char = body[index] ?? ''
    if (char === '*') {
      if (body[index + 1] === '*') {
        index++
        if (body[index + 1] === '/') {
          index++
          source += '(?:[^/]+/)*'
        } else {
          source += '.*'
        }
        continue
      }
      source += '[^/]*'
      continue
    }
    if (char === '?') {
      source += '[^/]'
      continue
    }
    source += GLOB_RESERVED.has(char) ? `\\${char}` : char
  }
  const anchored = rootAnchored || body.includes('/') ? source : `(?:.*/)?${source}`
  return new RegExp(`^${anchored}(?:/.*)?$`)
}

const matcherOf = (globs: readonly string[]): ((path: string) => boolean) => {
  const patterns = globs.map(compileGlob)
  return (path: string) => patterns.some((pattern) => pattern.test(path))
}

export function selectionPolicyOf(spec: ArtifactSpec): SelectionPolicy {
  return {
    hardExcluded: (path: string) => isHardExcluded({ path }),
    forceIncluded: matcherOf(spec.publish.include),
    forceExcluded: matcherOf(spec.publish.exclude),
  }
}

export function selectedByPolicy(args: {
  path: string
  policy: SelectionPolicy
  fromGit: boolean
}): boolean {
  if (args.policy.hardExcluded(args.path)) return false
  if (args.policy.forceIncluded(args.path)) return true
  if (args.policy.forceExcluded(args.path)) return false
  return args.fromGit
}
