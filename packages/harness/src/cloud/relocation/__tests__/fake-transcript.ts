import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { toThreadId, type Event } from '@dltech/atlas-core'
import { extractSessionArchive } from '../../session-archive'
import { parseEventLines } from '../../../store/sessions/lines'

export async function eventsInArchive(archive: Uint8Array): Promise<Event[]> {
  const sessionDir = await mkdtemp(join(tmpdir(), 'atlas-fake-transcript-'))
  try {
    await extractSessionArchive({ archive, sessionDir })
    const directory = join(sessionDir, 'threads')
    const files = await readdir(directory).catch(() => [] as string[])
    const events: Event[] = []
    for (const file of files) {
      if (!file.endsWith('.events.jsonl')) continue
      const threadId = toThreadId(file.slice(0, -'.events.jsonl'.length))
      const text = await readFile(join(directory, file), 'utf8')
      events.push(...parseEventLines({ text, threadId }).events)
    }
    return events
  } finally {
    await rm(sessionDir, { recursive: true, force: true })
  }
}
