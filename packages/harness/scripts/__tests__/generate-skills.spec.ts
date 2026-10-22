import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { generateSkills } from '../generate-skills'

let workspace: string

const layoutOf = () => ({
  skillsRoot: join(workspace, 'skills'),
  manifestFile: join(workspace, 'src', 'skills', 'manifest.generated.ts'),
  chunkDirectory: join(workspace, 'src', 'skills', 'bundle-files.generated'),
})

const write = (args: { path: string; content: string | Uint8Array }): void => {
  mkdirSync(join(args.path, '..'), { recursive: true })
  writeFileSync(args.path, args.content)
}

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'generate-skills-'))
  write({ path: join(workspace, 'src', 'skills', 'embedded-bundle.ts'), content: 'export {}\n' })
  write({ path: join(workspace, 'skills', 'flat.md'), content: '---\nname: flat\ndescription: Flat.\n---\nBody `tick` ${x}\n' })
  write({ path: join(workspace, 'skills', 'text-only', 'SKILL.md'), content: '---\nname: text-only\ndescription: T.\n---\n' })
  write({ path: join(workspace, 'skills', 'rich', 'SKILL.md'), content: '---\nname: rich\ndescription: R.\n---\n' })
  write({ path: join(workspace, 'skills', 'rich', 'references', 'a.md'), content: '# A\n' })
  write({ path: join(workspace, 'skills', 'rich', 'assets', 'page.jpg'), content: new Uint8Array([0, 255, 0]) })
  write({ path: join(workspace, 'skills', 'rich', 'assets', 'SKILL.md'), content: 'nested\n' })
  write({ path: join(workspace, 'skills', 'not-a-skill', 'notes.txt'), content: 'ignored\n' })
})

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true })
})

describe('generateSkills', () => {
  it('emits only root Markdown and SKILL.md folders as entries, resources as bundle files', async () => {
    const result = await generateSkills(layoutOf())
    const manifest = readFileSync(layoutOf().manifestFile, 'utf8')

    expect(result).toEqual({ skills: 3, resources: 3, modules: 1 })
    expect(manifest).toContain('path: "flat.md"')
    expect(manifest).toContain('path: "text-only/SKILL.md"')
    expect(manifest).toContain('path: "rich/SKILL.md"')
    expect(manifest).not.toContain('references/a.md')
    expect(manifest).not.toContain('not-a-skill')
    expect(manifest).toContain('Body `tick` ${x}')
    expect(manifest.match(/bundle:/g)).toHaveLength(1)
  })

  it('keeps a large entry corpus under the manifest line bound without truncating text', async () => {
    const bodies = Array.from({ length: 3 }, (_, index) =>
      `---\nname: long-${index}\ndescription: Long.\n---\n${'Body `tick` ${value}\n'.repeat(150)}`,
    )
    for (const [index, body] of bodies.entries()) {
      expect(body.split('\n').length).toBeGreaterThan(150)
      write({ path: join(workspace, 'skills', `long-${index}.md`), content: body })
    }
    await generateSkills(layoutOf())
    const manifest = readFileSync(layoutOf().manifestFile, 'utf8')
    expect(manifest.split('\n').length).toBeLessThanOrEqual(300)
    for (const body of bodies) expect(manifest).toContain(JSON.stringify(body))
  })

  it('imports each resource natively instead of inlining its bytes', async () => {
    await generateSkills(layoutOf())
    const [chunk] = readdirSync(layoutOf().chunkDirectory)
    const text = readFileSync(join(layoutOf().chunkDirectory, chunk ?? ''), 'utf8')

    expect(text).toContain('assets/page.jpg')
    expect(text).toContain("{ with: { type: 'file' } }")
    expect(text).toContain('"../../../skills/rich/assets/page.jpg" as string')
    expect(text).toContain('assets/SKILL.md')
  })

  it('is deterministic and splits modules at the size bound', async () => {
    for (let index = 0; index < 205; index += 1) {
      write({ path: join(workspace, 'skills', 'rich', 'assets', `p-${index}.bin`), content: new Uint8Array([index % 256]) })
    }
    const first = await generateSkills(layoutOf())
    const manifest = readFileSync(layoutOf().manifestFile, 'utf8')
    const second = await generateSkills(layoutOf())

    expect(first.modules).toBe(3)
    expect(second).toEqual(first)
    expect(readFileSync(layoutOf().manifestFile, 'utf8')).toBe(manifest)
    for (const chunk of readdirSync(layoutOf().chunkDirectory)) {
      expect(readFileSync(join(layoutOf().chunkDirectory, chunk), 'utf8').split('\n').length).toBeLessThanOrEqual(300)
    }
  })

  it('changes the bundle digest when a resource changes', async () => {
    await generateSkills(layoutOf())
    const before = readFileSync(layoutOf().manifestFile, 'utf8')
    write({ path: join(workspace, 'skills', 'rich', 'assets', 'page.jpg'), content: new Uint8Array([9]) })
    await generateSkills(layoutOf())

    expect(readFileSync(layoutOf().manifestFile, 'utf8')).not.toBe(before)
  })

  it('removes only recognized stale chunk modules and leaves unexpected files alone', async () => {
    await generateSkills(layoutOf())
    const bystander = join(layoutOf().chunkDirectory, 'notes.txt')
    const lookalike = join(layoutOf().chunkDirectory, 'files-1.ts')
    writeFileSync(bystander, 'mine')
    writeFileSync(lookalike, 'mine')
    writeFileSync(join(layoutOf().chunkDirectory, 'files-099.ts'), 'stale')
    rmSync(join(workspace, 'skills', 'rich'), { recursive: true })

    const result = await generateSkills(layoutOf())

    expect(result.modules).toBe(0)
    expect(readdirSync(layoutOf().chunkDirectory).sort()).toEqual(['files-1.ts', 'notes.txt'])
  })

  it('keeps the chunk directory and unchanged files in place across regeneration', async () => {
    await generateSkills(layoutOf())
    const chunk = join(layoutOf().chunkDirectory, 'files-000.ts')
    const before = lstatSync(chunk, { bigint: true })
    const manifestBefore = lstatSync(layoutOf().manifestFile, { bigint: true })

    await generateSkills(layoutOf())

    expect(lstatSync(chunk, { bigint: true }).ino).toBe(before.ino)
    expect(lstatSync(layoutOf().manifestFile, { bigint: true }).ino).toBe(manifestBefore.ino)
  })

  it('survives parallel generation of the same input, leaving no temp files and an unexpected file intact', async () => {
    await generateSkills(layoutOf())
    const bystander = join(layoutOf().chunkDirectory, 'notes.txt')
    writeFileSync(bystander, 'mine')
    write({ path: join(workspace, 'skills', 'rich', 'assets', 'page.jpg'), content: new Uint8Array([4, 2]) })

    const results = await Promise.all(Array.from({ length: 8 }, () => generateSkills(layoutOf())))

    expect(new Set(results.map((result) => JSON.stringify(result))).size).toBe(1)
    expect(readFileSync(bystander, 'utf8')).toBe('mine')
    expect(readdirSync(layoutOf().chunkDirectory).sort()).toEqual(['files-000.ts', 'notes.txt'])
    expect(readdirSync(join(workspace, 'src', 'skills')).filter((name) => name.endsWith('.tmp'))).toEqual([])
    expect(readFileSync(layoutOf().manifestFile, 'utf8')).toContain('bundle:')
  })

  it('refuses symlinks inside a bundle', async () => {
    symlinkSync(join(workspace, 'skills', 'flat.md'), join(workspace, 'skills', 'rich', 'link.md'))

    await expect(generateSkills(layoutOf())).rejects.toThrow('symlink')
  })
})
