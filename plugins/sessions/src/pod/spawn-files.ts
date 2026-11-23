import {
  ATLAS_CONTEXT_DIR_ENV,
  contextFilePathOf,
  SPAWN_FILES_MAX_BYTES,
  SPAWN_FILE_MAX_BYTES,
  spawnFilesRefusalOf,
  type SpawnFile,
} from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { ECallStatus } from '@dltech/atlas-protocol'

const contextDirectoryOf = async (ctx: PluginPodContext): Promise<string> => {
  const directory = (await ctx.env?.())?.[ATLAS_CONTEXT_DIR_ENV]
  if (directory === undefined || directory === '') {
    throw new Error('this session has no context folder, so it cannot attach files')
  }
  return directory
}

const textRefusalOf = (file: { relativePath: string; text: string | null }): string | null => {
  if (file.text === null) return `${file.relativePath} is not UTF-8 text; attach a text file`
  if (file.text.includes('\u0000')) {
    return `${file.relativePath} holds a NUL byte, so it is not text; attach a text file`
  }
  return null
}

const fileOf = async (args: {
  ctx: PluginPodContext
  directory: string
  relativePath: string
}): Promise<SpawnFile> => {
  const resolved = contextFilePathOf({
    directory: args.directory,
    relativePath: args.relativePath,
  })
  if (!resolved.ok) throw new Error(resolved.reason)
  const stat = await args.ctx.call({ op: 'stat', path: resolved.path })
  if (stat.status !== ECallStatus.Ok) {
    throw new Error(`could not read ${args.relativePath}: ${stat.error.message}`)
  }
  if (stat.op !== 'stat') {
    throw new Error(`could not read ${args.relativePath}: the daemon answered ${stat.op}`)
  }
  if (stat.value.size > SPAWN_FILE_MAX_BYTES) {
    throw new Error(
      `${args.relativePath} is ${stat.value.size} bytes; attach files of at most ${SPAWN_FILE_MAX_BYTES} bytes each`,
    )
  }
  const result = await args.ctx.call({ op: 'readTextForEdit', path: resolved.path })
  if (result.status !== ECallStatus.Ok) {
    throw new Error(`could not read ${args.relativePath}: ${result.error.message}`)
  }
  if (result.op !== 'readTextForEdit') {
    throw new Error(`could not read ${args.relativePath}: the daemon answered ${result.op}`)
  }
  const text = textRefusalOf({ relativePath: args.relativePath, text: result.value.strict })
  if (text !== null) throw new Error(text)
  return { path: args.relativePath, text: result.value.strict ?? '' }
}

export const spawnFilesOf = async (args: {
  ctx: PluginPodContext
  paths: readonly string[] | undefined
}): Promise<readonly SpawnFile[] | undefined> => {
  if (args.paths === undefined || args.paths.length === 0) return undefined
  const directory = await contextDirectoryOf(args.ctx)
  const files: SpawnFile[] = []
  let total = 0
  for (const relativePath of args.paths) {
    const file = await fileOf({ ctx: args.ctx, directory, relativePath })
    total += new TextEncoder().encode(file.text).length
    if (total > SPAWN_FILES_MAX_BYTES) {
      throw new Error(`the attached files are more than ${SPAWN_FILES_MAX_BYTES} bytes in all`)
    }
    files.push(file)
  }
  const refusal = spawnFilesRefusalOf(files)
  if (refusal !== null) throw new Error(refusal)
  return files
}

export const attachedNamesOf = (files: readonly SpawnFile[] | undefined): string =>
  files === undefined || files.length === 0 ? '' : files.map((file) => file.path).join(', ')

export const filesTextOf = (files: readonly SpawnFile[] | undefined): string => {
  if (files === undefined || files.length === 0) return ''
  return ` It has ${files.length === 1 ? 'the attached file' : 'the attached files'}: ${attachedNamesOf(files)}.`
}
