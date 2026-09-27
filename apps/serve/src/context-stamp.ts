import { join } from 'node:path'

import type { WorkspaceFiles } from './workspace-files'

const CONTEXT_STAMP_FILE = 'context.stamp'

export type ContextStamp = { projectDirectory: string | null; identity: string | null }

export const contextStampPath = (atlasHome: string): string => join(atlasHome, CONTEXT_STAMP_FILE)

export const parseContextStamp = (text: string): ContextStamp | null => {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const projectDirectory = Reflect.get(parsed, 'projectDirectory')
  const identity = Reflect.get(parsed, 'identity')
  const held = typeof projectDirectory === 'string' ? projectDirectory : null
  return { projectDirectory: held, identity: typeof identity === 'string' ? identity : null }
}

/**
 * A sandbox snapshot restores the whole filesystem across stop/resume, this stamp included, so its
 * presence is what tells a resumed boot apart from a freshly created one that has never received
 * context yet.
 */
export const readContextStamp = async (args: {
  files: WorkspaceFiles
  atlasHome: string
}): Promise<ContextStamp | null> => {
  const path = contextStampPath(args.atlasHome)
  if (!(await args.files.exists(path))) return null
  try {
    return parseContextStamp(await args.files.read(path))
  } catch {
    return null
  }
}

export const stampContextWithoutFailingBoot = (args: {
  files: WorkspaceFiles
  atlasHome: string
  projectDirectory: string | null
  identity: string | null
}): Promise<void> =>
  args.files
    .write({
      path: contextStampPath(args.atlasHome),
      text: JSON.stringify({ projectDirectory: args.projectDirectory, identity: args.identity }),
    })
    .catch(() => undefined)

