import { contextFilePathOf, type SpawnFile } from '@dltech/atlas-core'

export type ContextFileWrites = {
  mkdir(args: { path: string }): Promise<void>
  writeFile(args: { path: string; content: string }): Promise<void>
  readLink(args: { path: string }): Promise<string | null>
}

export type ContextFilePlacement = { written: number; refused: readonly string[] }

const parentOf = (path: string): string => {
  const index = path.lastIndexOf('/')
  return index <= 0 ? '/' : path.slice(0, index)
}

const componentsOf = (args: { directory: string; relativePath: string }): string[] => {
  const found: string[] = []
  let current = args.directory.replace(/\/+$/, '')
  for (const segment of args.relativePath.split('/')) {
    current = `${current}/${segment}`
    found.push(current)
  }
  return found
}

const linkReasonOf = (args: { file: SpawnFile; at: string }): { ok: false; reason: string } => ({
  ok: false,
  reason: `${args.file.path} goes through ${args.at}, which is a link, so Atlas does not write through it`,
})

const refusalOf = async (args: {
  file: SpawnFile
  directory: string
  writes: ContextFileWrites
}): Promise<{ ok: false; reason: string } | { ok: true; target: string }> => {
  const target = contextFilePathOf({ directory: args.directory, relativePath: args.file.path })
  if (!target.ok) return target
  for (const path of componentsOf({ directory: args.directory, relativePath: args.file.path })) {
    const link = await args.writes.readLink({ path })
    if (link !== null) return linkReasonOf({ file: args.file, at: path })
  }
  return { ok: true, target: target.path }
}

export const placeContextFiles = async (args: {
  files: readonly SpawnFile[]
  directory: string
  writes: ContextFileWrites
}): Promise<ContextFilePlacement> => {
  const refused: string[] = []
  let written = 0
  for (const file of args.files) {
    const allowed = await refusalOf({ file, directory: args.directory, writes: args.writes })
    if (!allowed.ok) {
      refused.push(allowed.reason)
      continue
    }
    await args.writes.mkdir({ path: parentOf(allowed.target) })
    await args.writes.writeFile({ path: allowed.target, content: file.text })
    written += 1
  }
  return { written, refused }
}

export type ContextFilePort = {
  mkdir(args: { path: string }): Promise<unknown>
  writeFile(args: { path: string; content: string }): Promise<unknown>
  readLink(args: { path: string }): Promise<string | null>
}

export const contextFilesPlacerOf =
  (args: { directory: string; port: ContextFilePort }) =>
  async (placed: { files: readonly SpawnFile[] }): Promise<ContextFilePlacement> =>
    await placeContextFiles({
      files: placed.files,
      directory: args.directory,
      writes: {
        mkdir: async ({ path }) => {
          await args.port.mkdir({ path })
        },
        writeFile: async ({ path, content }) => {
          await args.port.writeFile({ path, content })
        },
        readLink: async ({ path }) => await args.port.readLink({ path }),
      },
    })
