/** Peek at one span's rendered transcript. bun run src/tldr-eval-peek.ts <thread-title-substr> <anchorSeq> <throughSeq> */
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

import {
  atlasDirectory,
  createHarnessContainer,
  disposeAll,
  portToken,
  readSessionMetaSync,
  sessionMetaFile,
  sessionsDirectory,
} from '@dltech/atlas-harness'
import { EventLogPort, toThreadId, transcriptOfRange } from '@dltech/atlas-core'

const [title, anchor, through] = process.argv.slice(2)

const container = createHarnessContainer()

try {
  const root = sessionsDirectory({ home: atlasDirectory() })
  const matches: { id: string; title: string; updatedAt: string }[] = []
  for (const dir of await readdir(root)) {
    const sessionDir = join(root, dir)
    const meta = readSessionMetaSync({ file: sessionMetaFile({ sessionDir }), sessionDir })
    if (meta?.title?.includes(title ?? '')) {
      matches.push({ id: meta.id, title: meta.title, updatedAt: meta.updatedAt })
    }
  }
  matches.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const thread = matches[0]
  if (thread === undefined) throw new Error(`no thread matching ${title}`)

  const events = await container.resolve(portToken(EventLogPort)).read({ threadId: toThreadId(thread.id) })
  console.log(
    transcriptOfRange({
      events,
      fromSeq: Number(anchor),
      throughSeq: Number(through),
    }),
  )
} finally {
  await disposeAll({ container })
}
