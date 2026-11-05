import type { StoredEvent } from '../../port'

export const bisectAfter = (params: { rows: readonly StoredEvent[]; afterSeq: number }): number => {
  const { rows, afterSeq } = params
  let low = 0
  let high = rows.length
  while (low < high) {
    const mid = (low + high) >> 1
    if ((rows[mid] as StoredEvent).seq > afterSeq) high = mid
    else low = mid + 1
  }
  return low
}
