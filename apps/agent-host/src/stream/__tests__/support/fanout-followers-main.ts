export {}

const required = (name: string): string => {
  const value = process.env[name]
  if (value === undefined) throw new Error(`${name} is required`)
  return value
}

type Follower = { last: number; live: boolean; gaps: number; duplicates: number }

type EventsFrame = {
  type: string
  events?: { seq: number; type: string; text?: string }[]
  head?: { seq: number }
  live?: boolean
}

const url = required('STREAM_URL')
const sessionId = required('SESSION_ID')
const followers = Number(required('FOLLOWERS'))
const appends = Number(required('APPENDS'))

const now = (): number => performance.timeOrigin + performance.now()

const states: Follower[] = Array.from({ length: followers }, () => ({
  last: -1,
  live: false,
  gaps: 0,
  duplicates: 0,
}))
const latencies = new Float64Array(followers * appends + followers)
let recorded = 0
let liveCount = 0
let closed = 0
let recording = false
let announced = false

const announceWhenAllLive = (): void => {
  if (announced || liveCount < followers) return
  announced = true
  recording = true
  console.log('ready')
}

const handleEvents = (state: Follower, frame: EventsFrame): void => {
  const arrival = now()
  const events = frame.events ?? []
  if (state.last < 0) state.last = (events[0]?.seq ?? (frame.head?.seq ?? 0) + 1) - 1
  for (const event of events) {
    if (event.seq <= state.last) {
      state.duplicates += 1
      continue
    }
    state.gaps += event.seq - state.last - 1
    state.last = event.seq
    const sentAt = Number(event.text)
    if (recording && event.type === 'user-said' && sentAt > 1e12 && recorded < latencies.length) {
      latencies[recorded] = arrival - sentAt
      recorded += 1
    }
  }
  if (frame.live === true && !state.live) {
    state.live = true
    liveCount += 1
    announceWhenAllLive()
  }
}

const open = (state: Follower): void => {
  const socket = new WebSocket(url)
  socket.addEventListener('open', () =>
    socket.send(JSON.stringify({ type: 'hello', v: 2, token: 'tok-a' })),
  )
  socket.addEventListener('close', () => {
    closed += 1
  })
  socket.addEventListener('message', (message) => {
    const frame = JSON.parse(String(message.data)) as EventsFrame
    if (frame.type === 'ready') {
      socket.send(JSON.stringify({ type: 'subscribe', id: 'sub-1', kind: 'session', sessionId }))
      return
    }
    if (frame.type === 'events') handleEvents(state, frame)
  })
}

const percentile = (sorted: Float64Array, fraction: number): number =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0

for (const state of states) open(state)

for await (const chunk of Bun.stdin.stream()) {
  if (chunk.length > 0) break
}

const sorted = latencies.slice(0, recorded).sort()
console.log(
  JSON.stringify({
    followers,
    received: recorded,
    expected: followers * appends,
    p50: percentile(sorted, 0.5),
    p99: percentile(sorted, 0.99),
    max: sorted[sorted.length - 1] ?? 0,
    gaps: states.reduce((sum, state) => sum + state.gaps, 0),
    duplicates: states.reduce((sum, state) => sum + state.duplicates, 0),
    closed,
    live: liveCount,
  }),
)
process.exit(0)
