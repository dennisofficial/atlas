import { describe, expect, it } from 'bun:test'

import {
  HARD_EXCLUDED,
  isHardExcluded,
  selectedByPolicy,
  selectionPolicyOf,
  type SelectionPolicy,
} from '../selection'
import { parseSpec } from '../spec'

const policyOf = (
  args: { include?: readonly string[]; exclude?: readonly string[] } = {},
): SelectionPolicy =>
  selectionPolicyOf(
    parseSpec({
      publish: { include: [...(args.include ?? [])], exclude: [...(args.exclude ?? [])] },
    }),
  )

const excluded: readonly string[] = [
  '.git/config',
  '.git',
  'node_modules/left-pad/index.js',
  'node_modules',
  '.venv/lib/python3.12/site.py',
  'a/__pycache__/b.pyc',
  '.env',
  '.env.local',
  '.env.production',
  'src/.env.local',
  'package/../secret.txt',
  'nested/./file',
  '',
]

const kept: readonly string[] = [
  'index.html',
  '.env.example',
  'src/.env.example',
  'src/app.js',
  'node_modules.mjs',
  '__pycache__.md',
  'a/.gitignore',
]

describe('isHardExcluded', () => {
  it('lists the directory names it drops', () => {
    expect(HARD_EXCLUDED).toContain('.git')
    expect(HARD_EXCLUDED).toContain('node_modules')
    expect(HARD_EXCLUDED).toContain('.venv')
    expect(HARD_EXCLUDED).toContain('__pycache__')
  })

  it.each(excluded)('excludes %p', (path) => {
    expect(isHardExcluded({ path })).toBe(true)
  })

  it.each(kept)('keeps %p', (path) => {
    expect(isHardExcluded({ path })).toBe(false)
  })

  it('excludes absolute paths and NUL bytes', () => {
    expect(isHardExcluded({ path: '/etc/passwd' })).toBe(true)
    expect(isHardExcluded({ path: 'src/\u0000.js' })).toBe(true)
  })
})

describe('selectionPolicyOf', () => {
  it('matches a directory glob against everything under it', () => {
    const policy = policyOf({ include: ['dist'] })
    expect(policy.forceIncluded('dist')).toBe(true)
    expect(policy.forceIncluded('dist/out.js')).toBe(true)
    expect(policy.forceIncluded('dist2/out.js')).toBe(false)
  })

  it('matches a basename glob at any depth', () => {
    const policy = policyOf({ include: ['*.log'] })
    expect(policy.forceIncluded('debug.log')).toBe(true)
    expect(policy.forceIncluded('logs/debug.log')).toBe(true)
    expect(policy.forceIncluded('debug.log.js')).toBe(false)
  })

  it('matches a double-star glob', () => {
    const policy = policyOf({ exclude: ['assets/**/*.map'] })
    expect(policy.forceExcluded('assets/app.js.map')).toBe(true)
    expect(policy.forceExcluded('assets/img/app.js.map')).toBe(true)
    expect(policy.forceExcluded('assets/app.js')).toBe(false)
  })

  it('matches a single-character wildcard', () => {
    const policy = policyOf({ exclude: ['page?.html'] })
    expect(policy.forceExcluded('page1.html')).toBe(true)
    expect(policy.forceExcluded('page12.html')).toBe(false)
  })

  it('treats a leading slash as the artifact root', () => {
    const policy = policyOf({ exclude: ['/secret.js'] })
    expect(policy.forceExcluded('secret.js')).toBe(true)
    expect(policy.forceExcluded('src/secret.js')).toBe(false)
  })

  it('escapes regex metacharacters in globs', () => {
    const policy = policyOf({ exclude: ['a+b.js', 'a(b).js'] })
    expect(policy.forceExcluded('a+b.js')).toBe(true)
    expect(policy.forceExcluded('aab.js')).toBe(false)
    expect(policy.forceExcluded('a(b).js')).toBe(true)
  })

  it('ignores blank globs', () => {
    const policy = policyOf({ exclude: ['', '   '] })
    expect(policy.forceExcluded('index.html')).toBe(false)
  })
})

describe('selectedByPolicy', () => {
  const precedence: readonly {
    name: string
    path: string
    fromGit: boolean
    expected: boolean
    include?: readonly string[]
    exclude?: readonly string[]
  }[] = [
    {
      name: 'a hard exclusion beats a force-include',
      path: 'node_modules/left-pad/index.js',
      include: ['node_modules/**'],
      fromGit: false,
      expected: false,
    },
    {
      name: 'a force-include beats a force-exclude',
      path: 'keep.log',
      include: ['keep.log'],
      exclude: ['*.log'],
      fromGit: false,
      expected: true,
    },
    {
      name: 'a force-exclude beats git selecting the file',
      path: 'src/secret.js',
      exclude: ['src/secret.js'],
      fromGit: true,
      expected: false,
    },
    {
      name: 'a force-include beats git ignoring the file',
      path: 'trace.log',
      include: ['trace.log'],
      fromGit: false,
      expected: true,
    },
    { name: 'git selecting the file is kept', path: 'index.html', fromGit: true, expected: true },
    {
      name: 'git not selecting the file is dropped',
      path: 'index.html',
      fromGit: false,
      expected: false,
    },
  ]

  it.each(precedence)('$name', ({ path, fromGit, expected, include, exclude }) => {
    const policy = policyOf({
      ...(include === undefined ? {} : { include }),
      ...(exclude === undefined ? {} : { exclude }),
    })
    expect(selectedByPolicy({ path, policy, fromGit })).toBe(expected)
  })
})
