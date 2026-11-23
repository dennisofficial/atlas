import { contextFilePathOf, type SpawnFile } from '@dltech/atlas-core'

export type ContextFileWrites = {
  mkdir(args: { path: string }): Promise<void>
  writeFile(args: { path: string; content: string }): Promise<void>
}

export type ContextFilePlacement = { written: number; refused: readonly string[] }

const parentOf = (path: string): string => {
  const index = path.lastIndexOf('/')
  return index <= 0 ? '/' : path.slice(0, index)
}

export const placeContextFiles = async (args: {
  files: readonly SpawnFile[]
  directory: string
  writes: ContextFileWrites
}): Promise<ContextFilePlacement> => {
  const refused: string[] = []
  let written = 0
  for (const file of args.files) {
    const target = contextFilePathOf({ directory: args.directory, relativePath: file.path })
    if (!target.ok) {
      refused.push(target.reason)
      continue
    }
    await args.writes.mkdir({ path: parentOf(target.path) })
    await args.writes.writeFile({ path: target.path, content: file.text })
    written += 1
  }
  return { written, refused }
}

export type ContextFilePort = {
  mkdir(args: { path: string }): Promise<unknown>
  writeFile(args: { path: string; content: string }): Promise<unknown>
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
      },
    })
