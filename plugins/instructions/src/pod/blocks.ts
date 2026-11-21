import { join } from 'node:path'

import { INSTRUCTION_FILE } from './sources'

export const PERSONAL_HEADER =
  "The operator's personal instructions from Atlas Cloud. They apply to every project:"

export const projectHeader = (path: string): string =>
  `Contents of ${path} (project instructions, checked into the codebase):`

export const blockOf = (args: { header: string; content: string }): string | null => {
  const content = args.content.trim()
  return content === '' ? null : `${args.header}\n\n${content}`
}

export const instructionPathOf = (directory: string): string => join(directory, INSTRUCTION_FILE)
