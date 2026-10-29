import { mkdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { digestOfText } from '../skills/embedded-bundle'
import { PLUGIN_TYPES_DIRECTORY_NAME, PLUGIN_TYPES_FILE_NAME } from './constants'
import { PLUGIN_TYPES_TEXT } from './plugin-types.generated'

export const pluginTypesPath = (home: string): string =>
  join(home, PLUGIN_TYPES_DIRECTORY_NAME, PLUGIN_TYPES_FILE_NAME)

const isCurrent = async (args: { path: string; text: string }): Promise<boolean> => {
  const file = Bun.file(args.path)
  if (!(await file.exists())) return false
  return digestOfText(await file.text()) === digestOfText(args.text)
}

export async function materializePluginTypes(args: {
  home: string
  text?: string | undefined
}): Promise<string> {
  const text = args.text ?? PLUGIN_TYPES_TEXT
  const path = pluginTypesPath(args.home)
  if (await isCurrent({ path, text })) return path

  await mkdir(join(args.home, PLUGIN_TYPES_DIRECTORY_NAME), {
    recursive: true,
  })
  const staged = `${path}.${process.pid}-${crypto.randomUUID()}.tmp`
  try {
    await Bun.write(staged, text)
    await rename(staged, path)
  } catch (error) {
    await rm(staged, { force: true })
    throw error
  }
  return path
}
