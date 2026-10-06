#!/usr/bin/env bun
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  assertSafeRelativePath,
  bundleDigestOf,
  digestOfBytes,
  digestOfText,
} from '../src/skills/embedded-bundle'
import { isSkillEntryFilename } from '../src/skills/skill'

const harnessRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const FILES_PER_MODULE = 100
const IGNORED_FILENAMES: ReadonlySet<string> = new Set(['.DS_Store'])

type Layout = { skillsRoot: string; manifestFile: string; chunkDirectory: string }

type SourceFile = { path: string; digest: string }

type SkillSource = {
  entryPath: string
  text: string
  entryDigest: string
  resources: readonly SourceFile[]
  hasBundle: boolean
}

export type GenerateSkillsResult = { skills: number; resources: number; modules: number }

const defaultLayout = (): Layout => ({
  skillsRoot: join(harnessRoot, 'skills'),
  manifestFile: join(harnessRoot, 'src', 'skills', 'manifest.generated.ts'),
  chunkDirectory: join(harnessRoot, 'src', 'skills', 'bundle-files.generated'),
})

const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

const forTemplateLiteral = (text: string): string =>
  text.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${')

const quoted = (text: string): string => JSON.stringify(text)

const pathOf = (...segments: readonly string[]): string => segments.join('/')

async function resourcesUnder(args: { root: string; directory: string }): Promise<readonly string[]> {
  const found: string[] = []
  const names = (await readdir(join(args.root, args.directory))).sort(byCodePoint)

  for (const name of names) {
    if (IGNORED_FILENAMES.has(name)) continue
    const relativePath = args.directory === '' ? name : pathOf(args.directory, name)
    const info = await lstat(join(args.root, relativePath))

    if (info.isSymbolicLink()) throw new Error(`bundled skill resource ${relativePath} is a symlink`)
    if (info.isDirectory()) {
      found.push(...(await resourcesUnder({ root: args.root, directory: relativePath })))
      continue
    }
    if (!info.isFile()) throw new Error(`bundled skill resource ${relativePath} is not a regular file`)
    found.push(relativePath)
  }

  return found
}

async function digestedFile(args: { root: string; path: string }): Promise<SourceFile> {
  assertSafeRelativePath(args.path)
  return { path: args.path, digest: digestOfBytes(await readFile(join(args.root, args.path))) }
}

async function folderSkill(args: { skillsRoot: string; folder: string; entryName: string }): Promise<SkillSource> {
  const root = join(args.skillsRoot, args.folder)
  const everything = await resourcesUnder({ root, directory: '' })
  const resources = await Promise.all(
    everything.filter((path) => path !== args.entryName).map((path) => digestedFile({ root, path })),
  )
  const text = await readFile(join(root, args.entryName), 'utf8')

  return {
    entryPath: pathOf(args.folder, args.entryName),
    text,
    entryDigest: digestOfText(text),
    resources,
    hasBundle: resources.length > 0,
  }
}

async function authoredSkills(skillsRoot: string): Promise<readonly SkillSource[]> {
  const skills: SkillSource[] = []
  const names = (await readdir(skillsRoot).catch(() => [])).sort(byCodePoint)

  for (const name of names) {
    const info = await lstat(join(skillsRoot, name))

    if (info.isDirectory()) {
      const entryName = (await readdir(join(skillsRoot, name))).find(
        isSkillEntryFilename,
      )
      if (entryName === undefined) continue
      skills.push(await folderSkill({ skillsRoot, folder: name, entryName }))
      continue
    }

    if (!info.isFile() || !name.toLowerCase().endsWith('.md')) continue
    const text = await readFile(join(skillsRoot, name), 'utf8')
    skills.push({ entryPath: name, text, entryDigest: digestOfText(text), resources: [], hasBundle: false })
  }

  return skills
}

const chunked = <T>(args: { items: readonly T[]; size: number }): readonly (readonly T[])[] => {
  const chunks: T[][] = []
  for (let at = 0; at < args.items.length; at += args.size) chunks.push(args.items.slice(at, at + args.size))
  return chunks
}

const GENERATED_CHUNK_FILE = /^files-\d{3}\.ts$/

const writeIfChanged = async (args: { path: string; text: string }): Promise<void> => {
  const existing = await readFile(args.path, 'utf8').catch(() => undefined)
  if (existing === args.text) return

  const staging = join(dirname(args.path), `.${basename(args.path)}.${process.pid}.${crypto.randomUUID()}.tmp`)
  try {
    await writeFile(staging, args.text)
    await rename(staging, args.path)
  } catch (error) {
    await rm(staging, { force: true })
    throw error
  }
}

const removeStaleChunks = async (args: { directory: string; kept: ReadonlySet<string> }): Promise<void> => {
  const names = await readdir(args.directory).catch(() => [])
  const stale = names.filter((name) => GENERATED_CHUNK_FILE.test(name) && !args.kept.has(name))
  await Promise.all(stale.map((name) => rm(join(args.directory, name), { force: true })))
}

const moduleName = (index: number): string => `files-${String(index).padStart(3, '0')}`

const importSpecifier = (args: { from: string; to: string }): string => {
  const specifier = relative(args.from, args.to).split('\\').join('/')
  return specifier.startsWith('.') ? specifier : `./${specifier}`
}

const chunkModule = (args: {
  layout: Layout
  folder: string
  files: readonly SourceFile[]
}): string => {
  const helper = importSpecifier({
    from: args.layout.chunkDirectory,
    to: join(dirname(args.layout.manifestFile), 'embedded-bundle'),
  })
  const lines = args.files.map((file) => {
    const target = importSpecifier({
      from: args.layout.chunkDirectory,
      to: join(args.layout.skillsRoot, args.folder, file.path),
    })
    return `  embeddedFile({ path: ${quoted(file.path)}, digest: ${quoted(file.digest)}, load: () => import(${quoted(target)} as string, { with: { type: 'file' } }) }),`
  })

  return [
    '// GENERATED by packages/harness/scripts/generate-skills.ts — do not edit.',
    '',
    `import { embeddedFile, type EmbeddedSkillFile } from ${quoted(helper)}`,
    '',
    'export const FILES: readonly EmbeddedSkillFile[] = [',
    ...lines,
    ']',
    '',
  ].join('\n')
}

type Emitted = { entry: SkillSource; chunkNames: readonly string[]; bundleDigest: string | undefined }

async function writeChunks(args: {
  layout: Layout
  skills: readonly SkillSource[]
}): Promise<readonly Emitted[]> {
  let counter = 0
  const emitted: Emitted[] = []
  for (const skill of args.skills) {
    if (!skill.hasBundle) {
      emitted.push({ entry: skill, chunkNames: [], bundleDigest: undefined })
      continue
    }

    const folder = skill.entryPath.split('/')[0] ?? ''
    const chunkNames: string[] = []
    for (const files of chunked({ items: skill.resources, size: FILES_PER_MODULE })) {
      const name = moduleName(counter)
      counter += 1
      await mkdir(args.layout.chunkDirectory, { recursive: true })
      await writeIfChanged({
        path: join(args.layout.chunkDirectory, `${name}.ts`),
        text: chunkModule({ layout: args.layout, folder, files }),
      })
      chunkNames.push(name)
    }

    const entryName = skill.entryPath.split('/').slice(1).join('/')
    emitted.push({
      entry: skill,
      chunkNames,
      bundleDigest: bundleDigestOf({
        entry: { path: entryName, digest: skill.entryDigest },
        files: skill.resources,
      }),
    })
  }
  return emitted
}

const manifestEntry = (args: { emitted: Emitted; aliases: ReadonlyMap<string, string> }): string => {
  const { entry, bundleDigest, chunkNames } = args.emitted
  const head = `    path: ${quoted(entry.entryPath)},\n    text: \`${forTemplateLiteral(entry.text)}\`,`
  if (bundleDigest === undefined) return `  {\n${head}\n  },`

  const files = chunkNames.map((name) => `...${args.aliases.get(name)}`).join(', ')
  return `  {\n${head}\n    bundle: { digest: ${quoted(bundleDigest)}, files: [${files}] },\n  },`
}

async function writeManifest(args: { layout: Layout; emitted: readonly Emitted[] }): Promise<void> {
  const aliases = new Map<string, string>()
  const imports: string[] = []
  for (const name of args.emitted.flatMap((item) => item.chunkNames)) {
    const alias = `FILES_${name.replace('files-', '')}`
    aliases.set(name, alias)
    const specifier = importSpecifier({
      from: dirname(args.layout.manifestFile),
      to: join(args.layout.chunkDirectory, name),
    })
    imports.push(`import { FILES as ${alias} } from ${quoted(specifier)}`)
  }

  const body = [
    '// GENERATED by packages/harness/scripts/generate-skills.ts — do not edit.',
    '',
    "import type { EmbeddedSkillEntry } from './embedded-bundle'",
    ...imports,
    '',
    'export const BUILT_IN_SKILLS: readonly EmbeddedSkillEntry[] = [',
    ...args.emitted.map((emitted) => manifestEntry({ emitted, aliases })),
    ']',
    '',
  ].join('\n')

  await mkdir(dirname(args.layout.manifestFile), { recursive: true })
  await writeIfChanged({ path: args.layout.manifestFile, text: body })
}

export async function generateSkills(args: Partial<Layout> = {}): Promise<GenerateSkillsResult> {
  const layout = { ...defaultLayout(), ...args }
  const skills = await authoredSkills(layout.skillsRoot)
  const emitted = await writeChunks({ layout, skills })
  await writeManifest({ layout, emitted })
  await removeStaleChunks({
    directory: layout.chunkDirectory,
    kept: new Set(emitted.flatMap((item) => item.chunkNames.map((name) => `${name}.ts`))),
  })

  return {
    skills: skills.length,
    resources: skills.reduce((total, skill) => total + skill.resources.length, 0),
    modules: emitted.reduce((total, item) => total + item.chunkNames.length, 0),
  }
}

if (import.meta.main) {
  const repoRoot = join(harnessRoot, '..', '..')
  const result = await generateSkills()
  console.log(
    `skills → ${relative(repoRoot, defaultLayout().manifestFile)} (${result.skills} skills, ${result.resources} bundled resources in ${result.modules} modules)`,
  )
}
