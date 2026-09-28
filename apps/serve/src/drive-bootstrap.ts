import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  wireWorkspaceSpecSchema,
  type FetchContextArchive,
  type FetchTranscriptArchive,
  type FetchWorkspaceSpec,
} from './workspace-spec'

const BOOTSTRAP_DIRECTORY = 'bootstrap'
const WORKSPACE_SPEC_FILE = 'workspace-spec.json'
const CONTEXT_ARCHIVE_FILE = 'context.tar.gz'
const TRANSCRIPT_ARCHIVE_FILE = 'transcript.tar.gz'

const ENOENT = 'ENOENT'

const isMissing = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === ENOENT

const readArchiveOrNull = async (args: { path: string }): Promise<Uint8Array | null> => {
  try {
    return await readFile(args.path)
  } catch (error) {
    if (isMissing(error)) return null
    throw error
  }
}

export function driveWorkspaceSpecFetcher(args: { driveHome: string }): FetchWorkspaceSpec {
  const path = join(args.driveHome, BOOTSTRAP_DIRECTORY, WORKSPACE_SPEC_FILE)

  return async () => {
    let text: string
    try {
      text = await readFile(path, 'utf8')
    } catch (error) {
      throw new Error(
        `the workspace spec the laptop wrote is not on the drive at ${path}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
    return wireWorkspaceSpecSchema.parse(JSON.parse(text))
  }
}

export function driveContextArchiveFetcher(args: { driveHome: string }): FetchContextArchive {
  const path = join(args.driveHome, BOOTSTRAP_DIRECTORY, CONTEXT_ARCHIVE_FILE)
  return () => readArchiveOrNull({ path })
}

export function driveTranscriptArchiveFetcher(args: {
  driveHome: string
}): FetchTranscriptArchive {
  const path = join(args.driveHome, BOOTSTRAP_DIRECTORY, TRANSCRIPT_ARCHIVE_FILE)
  return () => readArchiveOrNull({ path })
}
