import { readlink } from 'node:fs/promises'
import { join } from 'node:path'

import { hashFile } from './capture-files'
import { ELogEntryKind, isCapturedCommonLog, walkLogs, type LogEntry } from './capture-reflog-seeds'

const LOGS_DIRECTORY = 'logs'

const describeEntry = async ({ scope, entry }: { scope: string; entry: LogEntry }): Promise<string> =>
  entry.kind === ELogEntryKind.Symlink
    ? `reflog-link\0${scope}\0${entry.path}\0${await readlink(entry.absolute)}`
    : `reflog\0${scope}\0${entry.path}\0${await hashFile(entry.absolute)}`

export async function describeCommonReflogs({
  commonDir,
  covered,
}: {
  commonDir: string
  covered: ReadonlySet<string>
}): Promise<string[]> {
  const entries = (await walkLogs({ root: join(commonDir, LOGS_DIRECTORY) })).filter((entry) =>
    isCapturedCommonLog({ path: entry.path, covered }),
  )
  return Promise.all(entries.map((entry) => describeEntry({ scope: 'common', entry })))
}

export async function describeLinkedReflogs({ gitDir }: { gitDir: string }): Promise<string[]> {
  const entries = await walkLogs({ root: join(gitDir, LOGS_DIRECTORY) })
  return Promise.all(entries.map((entry) => describeEntry({ scope: 'linked', entry })))
}
