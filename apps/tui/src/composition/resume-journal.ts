import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { ClockPort } from '@dltech/atlas-core'
import { atlasDirectory, SystemClock } from '@dltech/atlas-harness'

import type { ActiveConversation } from './resume-hint'
import { threadHandle } from './thread-slug'

const JOURNAL_NAME = 'resume-journal.log'

const CAP_BYTES = 512 * 1024
const KEEP_BYTES = 128 * 1024

const trimToCap = (file: string): void => {
  if (!existsSync(file) || statSync(file).size <= CAP_BYTES) return

  const tail = readFileSync(file, 'utf8').slice(-KEEP_BYTES)
  const firstBreak = tail.indexOf('\n')
  writeFileSync(file, firstBreak === -1 ? tail : tail.slice(firstBreak + 1))
}

const appendBestEffort = (args: { file: string; line: string }): void => {
  try {
    mkdirSync(dirname(args.file), { recursive: true })
    trimToCap(args.file)
    appendFileSync(args.file, args.line)
  } catch {
    return
  }
}

export function journalResume(args: {
  active: ActiveConversation | null
  command: string
  directory: string
  clock?: ClockPort
  file?: string
}): void {
  const active = args.active
  if (active === null || !active.started) return

  const file = args.file ?? join(atlasDirectory(), JOURNAL_NAME)
  const at = (args.clock ?? new SystemClock()).now()
  const handle = threadHandle(active)
  const line = `${at}  ${args.directory}  (pid ${process.pid})  ${args.command} --resume "${handle}"\n`

  appendBestEffort({ file, line })
}
