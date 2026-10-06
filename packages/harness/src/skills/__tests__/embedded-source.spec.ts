import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ECommandGroup, ECommandKind } from '@dltech/atlas-core'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import {
  bundleDigestOf,
  digestOfBytes,
  digestOfText,
  type EmbeddedSkillEntry,
  type EmbeddedSkillFile,
} from '../embedded-bundle'
import { EmbeddedSkillSource, type EmbeddedSkillFailure } from '../embedded-source'
import { LiveSkillRegistry } from '../live-registry'
import { ESkillOrigin } from '../skill'

let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'embedded-source-'))
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

const resource = (args: { path: string; bytes: Uint8Array }): EmbeddedSkillFile => ({
  path: args.path,
  digest: digestOfBytes(args.bytes),
  read: async () => args.bytes,
})

const BUNDLED_TEXT = '---\nname: bundled\ndescription: Has resources.\n---\n\nRead references/guide.md.\n'
const PAGE = new Uint8Array([0, 0xff, 0xd8, 0, 7])

const bundledEntry = (): EmbeddedSkillEntry => {
  const files = [
    resource({ path: 'references/guide.md', bytes: new TextEncoder().encode('# Guide\n') }),
    resource({ path: 'assets/SKILL.md', bytes: PAGE }),
  ]
  return {
    path: 'bundled/SKILL.md',
    text: BUNDLED_TEXT,
    bundle: {
      digest: bundleDigestOf({ entry: { path: 'SKILL.md', digest: digestOfText(BUNDLED_TEXT) }, files }),
      files,
    },
  }
}

const TEXT_ONLY: EmbeddedSkillEntry = {
  path: 'plain/SKILL.md',
  text: '---\nname: plain\ndescription: Text only.\n---\n\nBody.\n',
}

describe('EmbeddedSkillSource', () => {
  it('names every built-in after its manifest path and marks it built-in', async () => {
    const loaded = await new EmbeddedSkillSource().load()

    expect(loaded.length).toBeGreaterThan(0)
    for (const skill of loaded) {
      expect(skill.origin).toBe(ESkillOrigin.BuiltIn)
      expect(skill.spec.kind).toBe(ECommandKind.Skill)
      expect(skill.spec.group).toBe(ECommandGroup.Workspace)
      expect(skill.spec.name).toMatch(/^[a-z][a-z0-9:-]*$/)
      expect(skill.directory === undefined).toBe(skill.entryPath === undefined)
      expect(skill.warnings).toEqual([])
    }
  })

  it('carries the commit built-in with its frontmatter and body', async () => {
    const loaded = await new EmbeddedSkillSource().load()
    const commit = loaded.find((skill) => skill.spec.name === 'commit')

    expect(commit?.spec.summary).not.toBe('')
    expect(commit?.spec.argumentHint).toBe('[scope]')
    expect(commit?.body).toContain('<type>(<scope>): <description>')
    expect(commit?.userInvocable).toBe(true)
    expect(commit?.modelInvocable).toBe(true)
    expect(commit?.frontmatter.name).toBe('commit')
  })

  it('carries the resolving-merge-conflicts built-in with its frontmatter and body', async () => {
    const loaded = await new EmbeddedSkillSource().load()
    const skill = loaded.find((entry) => entry.spec.name === 'resolving-merge-conflicts')

    expect(skill?.spec.summary).toContain('merge/rebase conflict')
    expect(skill?.body).toContain('Resolve each hunk')
    expect(skill?.frontmatter.name).toBe('resolving-merge-conflicts')
  })

  it('keeps text-only entries directoryless and writes nothing to the home', async () => {
    const [skill] = await new EmbeddedSkillSource({ home, entries: [TEXT_ONLY] }).load()

    expect(skill?.spec.name).toBe('plain')
    expect(skill?.directory).toBeUndefined()
    expect(skill?.entryPath).toBeUndefined()
    expect(readdirSync(home)).toEqual([])
  })

  it('materializes a bundle under the explicit home and returns that directory unchanged', async () => {
    const entry = bundledEntry()
    const loaded = await new EmbeddedSkillSource({ home, entries: [TEXT_ONLY, entry] }).load()
    const bundled = loaded.find((skill) => skill.spec.name === 'bundled')

    expect(loaded.map((skill) => skill.spec.name)).toEqual(['plain', 'bundled'])
    expect(bundled?.directory).toBe(join(home, 'bin', 'skills', entry.bundle?.digest ?? '', 'bundled'))
    expect(bundled?.entryPath).toBe(join(bundled?.directory ?? '', 'SKILL.md'))
    expect(bundled?.warnings).toEqual([])
    expect(readFileSync(join(bundled?.directory ?? '', 'references/guide.md'), 'utf8')).toBe('# Guide\n')
    expect(new Uint8Array(readFileSync(join(bundled?.directory ?? '', 'assets/SKILL.md')))).toEqual(PAGE)
  })

  it('never turns bundled resources, even one named SKILL.md, into skills', async () => {
    const loaded = await new EmbeddedSkillSource({ home, entries: [bundledEntry()] }).load()

    expect(loaded.map((skill) => skill.spec.name)).toEqual(['bundled'])
  })

  it('defaults the cache to the Atlas home when none is named', async () => {
    const loaded = await new EmbeddedSkillSource({ entries: [bundledEntry()] }).load()
    const directory = loaded[0]?.directory ?? ''

    expect(directory).toContain(join(process.env['ATLAS_HOME'] ?? '', 'bin', 'skills'))
  })

  describe('when one bundled entry fails', () => {
    const faulty = (state: { broken: boolean }): EmbeddedSkillEntry => {
      const entry = bundledEntry()
      const [guide, ...rest] = entry.bundle?.files ?? []
      const wrapped: EmbeddedSkillFile = {
        path: guide?.path ?? '',
        digest: guide?.digest ?? '',
        read: async () => {
          if (state.broken) throw new Error('cache read failed')
          return await (guide?.read() ?? Promise.resolve(new Uint8Array()))
        },
      }
      return { ...entry, bundle: { digest: entry.bundle?.digest ?? '', files: [wrapped, ...rest] } }
    }

    it('keeps the other built-ins, reports the failure, and recovers on reload', async () => {
      const state = { broken: true }
      const failures: EmbeddedSkillFailure[] = []
      const registry = new LiveSkillRegistry({
        sources: () => [
          new EmbeddedSkillSource({
            home,
            entries: [TEXT_ONLY, faulty(state)],
            onFailure: (failure) => failures.push(failure),
          }),
        ],
      })

      await registry.reload()
      expect(registry.all().map((skill) => skill.spec.name)).toEqual(['plain'])
      expect(failures).toEqual([{ name: 'bundled', message: 'cache read failed' }])

      state.broken = false
      await registry.reload()
      expect(registry.all().map((skill) => skill.spec.name)).toEqual(['bundled', 'plain'])
      expect(registry.byName('bundled')?.directory).toBeDefined()
      expect(failures).toHaveLength(1)
    })

    it('reports an entry whose digest is not valid hex and still loads the rest', async () => {
      const failures: EmbeddedSkillFailure[] = []
      const invalid: EmbeddedSkillEntry = {
        ...bundledEntry(),
        bundle: { digest: '../escape', files: bundledEntry().bundle?.files ?? [] },
      }

      const loaded = await new EmbeddedSkillSource({
        home,
        entries: [invalid, TEXT_ONLY],
        onFailure: (failure) => failures.push(failure),
      }).load()

      expect(loaded.map((skill) => skill.spec.name)).toEqual(['plain'])
      expect(failures).toHaveLength(1)
      expect(failures[0]?.message).toContain('digest')
      expect(readdirSync(home)).toEqual([])
    })

    it('falls back to a console warning when the failure callback itself throws', async () => {
      const warned: unknown[][] = []
      const original = console.warn
      console.warn = (...parts: unknown[]) => void warned.push(parts)
      try {
        const loaded = await new EmbeddedSkillSource({
          home,
          entries: [faulty({ broken: true }), TEXT_ONLY],
          onFailure: () => {
            throw new Error('notice sink down')
          },
        }).load()

        expect(loaded.map((skill) => skill.spec.name)).toEqual(['plain'])
        expect(String(warned[0]?.[0])).toContain('built-in skill bundled is unavailable')
      } finally {
        console.warn = original
      }
    })
  })
})
