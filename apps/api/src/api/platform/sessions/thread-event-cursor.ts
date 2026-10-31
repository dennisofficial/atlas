export type ThreadEventCursor = { historyRev: number; seq: number }

export const encodeThreadEventCursor = (cursor: ThreadEventCursor): string =>
  `v1:${cursor.historyRev}:${cursor.seq}`

export function decodeThreadEventCursor(value: string | undefined): ThreadEventCursor | undefined {
  if (value === undefined) return undefined
  const match = /^v1:(0|[1-9]\d*):(0|[1-9]\d*)$/.exec(value)
  if (match === null) return undefined
  const historyRev = Number(match[1])
  const seq = Number(match[2])
  if (!Number.isSafeInteger(historyRev) || !Number.isSafeInteger(seq)) return undefined
  return { historyRev, seq }
}
