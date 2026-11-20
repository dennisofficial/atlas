import type { BenchOptions } from './cli'

export type BenchRow = {
  size: number
  profile: string
  start: string
  firstEventsMs: number | null
  liveMs: number | null
  timedOut: boolean
  bytesDown: number
  eventsFrames: number
  readEvents: number
  headCalls: number
  readSessionView: number
  stalls: number
  leftOpen: boolean
}

const ms = (value: number | null): string => (value === null ? 'n/a' : `${Math.round(value)}`)

const kbOf = (bytes: number): string => `${Math.round(bytes / 1024)}`

const rowCells = (row: BenchRow): string[] => [
  row.size.toLocaleString('en-US'),
  row.profile,
  row.start,
  ms(row.firstEventsMs),
  row.timedOut ? 'timeout' : ms(row.liveMs),
  kbOf(row.bytesDown),
  String(row.eventsFrames),
  String(row.readEvents),
  String(row.headCalls),
  String(stallsOf(row)),
  row.leftOpen ? 'yes' : 'no',
]

const stallsOf = (row: BenchRow): number => row.stalls

const HEADERS = [
  'events',
  'profile',
  'start',
  'first frame ms',
  'live ms',
  'KB down',
  'events frames',
  'readEvents',
  'head',
  'stalls',
  'left open',
]

export const renderTable = (rows: readonly BenchRow[]): string => {
  const lines = [
    `| ${HEADERS.join(' | ')} |`,
    `| ${HEADERS.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${rowCells(row).join(' | ')} |`),
  ]
  return lines.join('\n')
}

const resultsDir = new URL('./results/', import.meta.url)

export const writeResults = async (args: {
  rows: readonly BenchRow[]
  options: BenchOptions
  now: Date
}): Promise<string> => {
  const stamp = args.now.toISOString().replace(/[:.]/g, '-')
  const path = new URL(`${stamp}.json`, resultsDir)
  const body = {
    generatedAt: args.now.toISOString(),
    options: args.options,
    rows: args.rows,
  }
  await Bun.write(path, `${JSON.stringify(body, null, 2)}\n`)
  return path.pathname
}
