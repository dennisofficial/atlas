import {
  GENESIS_HASH,
  mediaPathname,
  type Hash,
  type MediaRef,
  type RecordEvent,
} from '@dltech/atlas-core'
import { sha256Hex, validateMediaBytes, VercelMediaStore } from '@dltech/atlas-media'

import {
  affectedThreads,
  applyRewrite,
  ensureArchive,
  insertMedia,
  mediaExists,
  openDb,
  readHead,
  readHolder,
  readRows,
  type AffectedThread,
  type EventRow,
} from './backfill-event-pictures/database'
import {
  inlinePictureCount,
  rechainFrom,
  rewriteEventPictures,
  verifyChain,
  type ChainRow,
  type PictureResolution,
} from './backfill-event-pictures/rewrite'

type Options = { apply: boolean; threadId: string | undefined }

type Tally = {
  threads: number
  skipped: number
  events: number
  pictures: number
  valid: number
  notKept: number
  uploaded: number
  reused: number
  bytes: number
}

const EMPTY_TALLY: Tally = {
  threads: 0,
  skipped: 0,
  events: 0,
  pictures: 0,
  valid: 0,
  notKept: 0,
  uploaded: 0,
  reused: 0,
  bytes: 0,
}

const optionsOf = (argv: readonly string[]): Options => {
  const index = argv.indexOf('--thread')
  return {
    apply: argv.includes('--apply'),
    threadId: index === -1 ? undefined : argv[index + 1],
  }
}

const chainRowsOf = (rows: readonly EventRow[]): ChainRow[] =>
  rows.map((row) => ({ seq: row.seq, canonical: row.canonical, hash: row.hash }))

const report = (message: string, data: Record<string, unknown>): void => {
  console.log(`${message} ${JSON.stringify(data)}`)
}

const processThread = async (args: {
  sql: ReturnType<typeof openDb>
  thread: AffectedThread
  store: VercelMediaStore | undefined
  apply: boolean
}): Promise<Tally> => {
  const tally = { ...EMPTY_TALLY, threads: 1 }
  const { sql, thread, store } = args
  const holder = await readHolder({ sql, sessionId: thread.sessionId })
  if (holder !== null) {
    report('busy', { threadId: thread.threadId, holderHostId: holder })
    return { ...tally, skipped: 1 }
  }
  const head = await readHead({ sql, threadId: thread.threadId })
  const rows = await readRows({ sql, threadId: thread.threadId, fromSeq: thread.firstSeq })
  const first = rows[0]
  if (first === undefined)
    throw new Error(`thread ${thread.threadId} has no rows from its first picture`)
  const storedHead = verifyChain({ rows: chainRowsOf(rows), prevHash: first.prevHash as Hash })
  if (storedHead !== head.headHash || rows.at(-1)?.seq !== head.headSeq)
    throw new Error(`thread ${thread.threadId} does not match its recorded head`)

  const resolve = async (picture: {
    data: string
    mediaType: string
    source?: string | undefined
  }): Promise<PictureResolution> => {
    const bytes = new Uint8Array(Buffer.from(picture.data, 'base64'))
    tally.pictures += 1
    tally.bytes += bytes.byteLength
    const checked = validateMediaBytes({ hash: sha256Hex(bytes), bytes })
    if (!checked.ok) {
      tally.notKept += 1
      return { kind: 'notKept', reason: checked.reason }
    }
    tally.valid += 1
    if (store === undefined) return { kind: 'media', media: checked.media }
    if (await mediaExists({ sql, userId: thread.userId, hash: checked.media.hash })) {
      tally.reused += 1
      return { kind: 'media', media: checked.media }
    }
    const media: MediaRef = checked.media
    await store.put({
      pathname: mediaPathname({ userId: thread.userId, hash: media.hash }),
      bytes,
      mediaType: media.mediaType,
    })
    await insertMedia({ sql, userId: thread.userId, media })
    tally.uploaded += 1
    return { kind: 'media', media }
  }

  const rewritten: RecordEvent[] = []
  const affectedSeqs: number[] = []
  for (const row of rows) {
    const event = JSON.parse(row.canonical) as RecordEvent
    const next = await rewriteEventPictures({ event, resolve })
    if (next !== event) affectedSeqs.push(row.seq)
    rewritten.push(next)
  }
  const rechain = rechainFrom({ events: rewritten, prevHash: first.prevHash as Hash })
  const remaining = inlinePictureCount(rechain.rows)
  if (remaining !== 0)
    throw new Error(`thread ${thread.threadId} keeps ${remaining} inline pictures`)
  const headHash = verifyChain({ rows: rechain.rows, prevHash: first.prevHash as Hash })
  report(args.apply ? 'rewritten' : 'would rewrite', {
    threadId: thread.threadId,
    events: affectedSeqs.length,
    pictures: tally.pictures,
    valid: tally.valid,
    notKept: tally.notKept,
    uploaded: tally.uploaded,
    reused: tally.reused,
    bytes: tally.bytes,
  })
  if (!args.apply) return { ...tally, events: affectedSeqs.length }

  const outcome = await applyRewrite({
    sql,
    threadId: thread.threadId,
    sessionId: thread.sessionId,
    expected: head,
    archiveFrom: affectedSeqs[0] as number,
    archiveThrough: affectedSeqs.at(-1) as number,
    rows: rechain.rows,
    headHash,
  })
  if (outcome.kind !== 'applied') {
    report(outcome.kind, { threadId: thread.threadId })
    return { ...tally, skipped: 1, events: affectedSeqs.length }
  }
  const after = await readRows({ sql, threadId: thread.threadId, fromSeq: 1 })
  const verifiedHead = verifyChain({ rows: chainRowsOf(after), prevHash: GENESIS_HASH })
  const left = inlinePictureCount(chainRowsOf(after))
  if (verifiedHead !== headHash || left !== 0)
    throw new Error(`thread ${thread.threadId} does not verify after the rewrite`)
  report('verified', { threadId: thread.threadId, headSeq: head.headSeq })
  return { ...tally, events: affectedSeqs.length }
}

const addTally = (total: Tally, part: Tally): Tally => ({
  threads: total.threads + part.threads,
  skipped: total.skipped + part.skipped,
  events: total.events + part.events,
  pictures: total.pictures + part.pictures,
  valid: total.valid + part.valid,
  notKept: total.notKept + part.notKept,
  uploaded: total.uploaded + part.uploaded,
  reused: total.reused + part.reused,
  bytes: total.bytes + part.bytes,
})

const main = async (): Promise<void> => {
  const options = optionsOf(Bun.argv.slice(2))
  const connection = process.env['DIRECT_URL'] ?? process.env['DATABASE_URL']
  if (connection === undefined)
    throw new Error('DIRECT_URL or DATABASE_URL must be set through dotenvx')
  const token = process.env['BLOB_READ_WRITE_TOKEN']
  if (options.apply && token === undefined)
    throw new Error('BLOB_READ_WRITE_TOKEN is required with --apply')
  const sql = openDb(connection)
  try {
    if (options.apply) await ensureArchive({ sql })
    const threads = await affectedThreads({ sql, threadId: options.threadId })
    report(options.apply ? 'applying' : 'dry run', { threads: threads.length })
    const store = options.apply && token !== undefined ? new VercelMediaStore({ token }) : undefined
    let total = EMPTY_TALLY
    for (const thread of threads)
      total = addTally(total, await processThread({ sql, thread, store, apply: options.apply }))
    report('done', total)
  } finally {
    await sql.close()
  }
}

await main()
