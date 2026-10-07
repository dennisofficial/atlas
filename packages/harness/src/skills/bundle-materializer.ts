import { mkdir, rename, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { ATLAS_BIN_DIRECTORY_NAME } from '../store/paths'
import {
  assertBundleDigest,
  assertSafeRelativePath,
  assertSafeSegment,
  digestOfBytes,
  digestOfText,
  type EmbeddedSkillEntry,
} from './embedded-bundle'
import {
  ensureRealDirectories,
  ensureRealDirectory,
  holdsFile,
  mapLimited,
  replaceFile,
  writeFileExclusive,
} from './bundle-cache-fs'

export const BUNDLED_SKILLS_DIRECTORY_NAME = 'skills'

const STAGING_PREFIX = '.staging-'

export class BundleResourceCorrupt extends Error {
  constructor(args: { path: string }) {
    super(`embedded resource ${args.path} does not match the digest recorded when the binary was built`)
  }
}

type Planned = { relative: string; digest: string; bytes: () => Promise<Uint8Array> }

type Materialization = { entry: EmbeddedSkillEntry; name: string; root: string }

const inflight = new Map<string, Promise<MaterializedBundle>>()

export type MaterializedBundle = { directory: string; entryPath: string }

export const bundleCacheRoot = (home: string): string =>
  join(home, ATLAS_BIN_DIRECTORY_NAME, BUNDLED_SKILLS_DIRECTORY_NAME)

const planOf = (entry: EmbeddedSkillEntry): readonly Planned[] => {
  const entryName = basename(entry.path)
  const resources = (entry.bundle?.files ?? []).map((file): Planned => {
    assertSafeRelativePath(file.path)
    return {
      relative: file.path,
      digest: file.digest,
      bytes: async () => {
        const bytes = await file.read()
        if (digestOfBytes(bytes) !== file.digest) throw new BundleResourceCorrupt({ path: file.path })
        return bytes
      },
    }
  })

  return [
    {
      relative: entryName,
      digest: digestOfText(entry.text),
      bytes: async () => new TextEncoder().encode(entry.text),
    },
    ...resources,
  ]
}

const ensureParent = async (args: { directory: string; relative: string }): Promise<void> => {
  const segments = dirname(args.relative) === '.' ? [] : dirname(args.relative).split('/')
  await ensureRealDirectories({ root: args.directory, segments })
}

const parentsOf = (planned: readonly Planned[]): readonly string[] => [
  ...new Set(planned.map((file) => file.relative).filter((relative) => dirname(relative) !== '.')),
]

const repair = async (args: {
  digestDirectory: string
  directory: string
  planned: readonly Planned[]
}): Promise<void> => {
  await ensureRealDirectory(args.digestDirectory)
  await ensureRealDirectory(args.directory)
  for (const parent of parentsOf(args.planned)) await ensureParent({ directory: args.directory, relative: parent })
  await mapLimited({
    items: args.planned,
    run: async (file) => {
      const path = join(args.directory, file.relative)
      if (await holdsFile({ path, digest: file.digest })) return

      await replaceFile({ path, bytes: await file.bytes(), digest: file.digest })
    },
  })
}

const stage = async (args: { cache: string; directory: string; planned: readonly Planned[] }): Promise<string> => {
  const staging = join(args.cache, `${STAGING_PREFIX}${process.pid}-${crypto.randomUUID()}`)
  const skill = join(staging, basename(args.directory))
  await mkdir(skill, { recursive: true, mode: 0o700 })

  try {
    await mapLimited({
      items: args.planned,
      run: async (file) => {
        await ensureParent({ directory: skill, relative: file.relative })
        await writeFileExclusive({ path: join(skill, file.relative), bytes: await file.bytes() })
      },
    })
    return staging
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
}

const publish = async (args: { staging: string; digestDirectory: string }): Promise<void> => {
  try {
    await rename(args.staging, args.digestDirectory)
  } catch (error) {
    await rm(args.staging, { recursive: true, force: true })
    const taken = await holdsDirectory(args.digestDirectory)
    if (!taken) throw error
  }
}

const holdsDirectory = async (path: string): Promise<boolean> => {
  try {
    await ensureRealDirectory(path)
    return true
  } catch {
    return false
  }
}

const run = async (args: Materialization): Promise<MaterializedBundle> => {
  const digest = assertBundleDigest(args.entry.bundle?.digest)

  const planned = planOf(args.entry)
  const digestDirectory = join(args.root, digest)
  const directory = join(digestDirectory, args.name)
  const entryPath = join(directory, basename(args.entry.path))

  await mkdir(args.root, { recursive: true, mode: 0o700 })

  const published = await holdsFile({ path: entryPath, digest: digestOfText(args.entry.text) })
  if (!published) {
    const staging = await stage({ cache: args.root, directory, planned })
    await publish({ staging, digestDirectory })
  }

  await repair({ digestDirectory, directory, planned })
  return { directory, entryPath }
}

export async function materializeSkillBundle(args: {
  home: string
  name: string
  entry: EmbeddedSkillEntry
}): Promise<MaterializedBundle> {
  assertSafeSegment(args.name)
  const digest = assertBundleDigest(args.entry.bundle?.digest)
  const root = bundleCacheRoot(args.home)
  const key = `${root}\0${digest}\0${args.name}`

  const running = inflight.get(key)
  if (running !== undefined) return running

  const started = run({ entry: args.entry, name: args.name, root }).finally(() => inflight.delete(key))
  inflight.set(key, started)
  return started
}
