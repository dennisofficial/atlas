import { join } from 'node:path'

import { linkedSpecText, SPEC_FILE_NAME } from '@dltech/atlas-artifacts'
import type { FileSystemPort } from '@dltech/atlas-core'

import { ArtifactRefused } from './artifact-port'
import { EMPTY_SPEC } from './artifact-publish-plan'

export type SpecFile = { path: string; raw: unknown }

const ABSENT = 'ENOENT'

const codeOf = (error: unknown): unknown =>
  error instanceof Error && 'code' in error ? error.code : undefined

async function textOrNull(args: { path: string; files: FileSystemPort }): Promise<string | null> {
  try {
    return await args.files.readFile({ path: args.path })
  } catch (error) {
    if (codeOf(error) === ABSENT) return null
    throw error
  }
}

export async function readSpecFile(args: {
  dir: string
  files: FileSystemPort
}): Promise<SpecFile> {
  const path = join(args.dir, SPEC_FILE_NAME)
  const text = await textOrNull({ path, files: args.files })
  if (text === null) return { path, raw: EMPTY_SPEC }
  try {
    return { path, raw: JSON.parse(text) }
  } catch {
    throw new ArtifactRefused(
      `${path} is not valid JSON, so this directory can be neither published nor linked to its artifact.`,
    )
  }
}

export async function writeLink(args: {
  file: SpecFile
  subdomain: string
  files: FileSystemPort
}): Promise<void> {
  await args.files.writeFile({
    path: args.file.path,
    content: linkedSpecText({ raw: args.file.raw, subdomain: args.subdomain }),
  })
}
