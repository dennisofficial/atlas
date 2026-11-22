import { describe, expect, it } from 'bun:test'

import { auditReadme, README_MAX_LINES, specifierOf, type PackageManifest } from '../audit'

const manifest = (args: { name: string; exports: readonly string[] }): PackageManifest => ({
  dir: `packages/${args.name}`,
  name: args.name,
  exports: args.exports,
})

const readmeOf = (lines: readonly string[]): string => `${lines.join('\n')}\n`

describe('specifierOf', () => {
  it('maps the root subpath to the bare name and keeps a subpath', () => {
    expect(specifierOf({ name: '@x/one', subpath: '.' })).toBe('@x/one')
    expect(specifierOf({ name: '@x/one', subpath: './pod' })).toBe('@x/one/pod')
  })
})

describe('auditReadme', () => {
  it('reports a missing README', () => {
    expect(
      auditReadme({ manifest: manifest({ name: '@x/one', exports: ['.'] }), readme: undefined }),
    ).toEqual(['no README.md'])
  })

  it('passes a README whose heading and entry points match', () => {
    const readme = readmeOf(['# @x/one', '', 'Import `@x/one` or `@x/one/pod`.'])
    expect(
      auditReadme({
        manifest: manifest({ name: '@x/one', exports: ['.', './pod'] }),
        readme,
      }),
    ).toEqual([])
  })

  it('reports a wrong heading', () => {
    const problems = auditReadme({
      manifest: manifest({ name: '@x/one', exports: ['.'] }),
      readme: readmeOf(['# One', '', 'Import `@x/one`.']),
    })
    expect(problems).toEqual(['first line must be "# @x/one"'])
  })

  it('reports a subpath entry point that the README does not name', () => {
    const problems = auditReadme({
      manifest: manifest({ name: '@x/one', exports: ['.', './pod'] }),
      readme: readmeOf(['# @x/one', '', 'Import `@x/one`.']),
    })
    expect(problems).toEqual(['entry point @x/one/pod is not named in backticks'])
  })

  it('accepts a specifier named in backticks only', () => {
    const problems = auditReadme({
      manifest: manifest({ name: '@x/one', exports: ['./pod'] }),
      readme: readmeOf(['# @x/one', '', 'Import @x/one/pod.']),
    })
    expect(problems).toEqual(['entry point @x/one/pod is not named in backticks'])
  })

  it('reports a README over the line limit', () => {
    const body = Array.from({ length: README_MAX_LINES }, (_, index) => `line ${index}`)
    const problems = auditReadme({
      manifest: manifest({ name: '@x/one', exports: ['.'] }),
      readme: readmeOf(['# @x/one', 'Import `@x/one`.', ...body]),
    })
    expect(problems).toEqual([`${README_MAX_LINES + 2} lines is more than ${README_MAX_LINES}`])
  })

  it('accepts a README at the line limit', () => {
    const body = Array.from({ length: README_MAX_LINES - 2 }, (_, index) => `line ${index}`)
    expect(
      auditReadme({
        manifest: manifest({ name: '@x/one', exports: ['.'] }),
        readme: readmeOf(['# @x/one', 'Import `@x/one`.', ...body]),
      }),
    ).toEqual([])
  })
})
