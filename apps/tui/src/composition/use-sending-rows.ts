import type { Event } from '@dltech/atlas-core'
import { useCallback, useRef, useState } from 'react'

export type SendingRow = {
  id: string
  text: string
  failed: boolean
}

const NOTHING_SENDING: readonly SendingRow[] = Object.freeze([])

/**
 * Typed text between "sent" and "durable": the message a remote commit has not yet answered for.
 * The rows live beside the transcript rather than in it so the durable row, when it arrives,
 * replaces the placeholder instead of sharing a render with it — and a refusal downgrades the row
 * rather than dropping what was typed.
 */
export function useSendingRows(): {
  rows: readonly SendingRow[]
  add: (text: string) => string
  markFailed: (id: string) => void
  markAllSendingFailed: () => void
  reconcile: (events: readonly Event[]) => void
  resolve: (text: string) => void
  reset: () => void
} {
  const [rows, setRows] = useState<readonly SendingRow[]>(NOTHING_SENDING)
  const held = useRef<readonly SendingRow[]>(NOTHING_SENDING)
  const nextId = useRef(0)

  const publish = useCallback((next: readonly SendingRow[]) => {
    held.current = next
    setRows(next.length === 0 ? NOTHING_SENDING : next)
  }, [])

  const add = useCallback(
    (text: string): string => {
      /**
       * Resending what the transcript already shows as refused is the retry, not a second message:
       * the row flips back to in-flight instead of being stacked beside itself.
       */
      const retry = held.current.find((row) => row.failed && row.text === text)
      if (retry !== undefined) {
        publish(held.current.map((row) => (row.id === retry.id ? { ...row, failed: false } : row)))
        return retry.id
      }

      nextId.current += 1
      const id = `sending-${nextId.current}`
      publish([...held.current, { id, text, failed: false }])
      return id
    },
    [publish],
  )

  const markFailed = useCallback(
    (id: string): void => {
      if (!held.current.some((row) => row.id === id)) return
      publish(held.current.map((row) => (row.id === id ? { ...row, failed: true } : row)))
    },
    [publish],
  )

  const markAllSendingFailed = useCallback((): void => {
    if (!held.current.some((row) => !row.failed)) return
    publish(held.current.map((row) => ({ ...row, failed: true })))
  }, [publish])

  /**
   * The durable log is the truth the rows answer to: a message it now holds stops being a
   * placeholder, even one marked failed — a close can race a commit that already landed, and the
   * row must follow what the log says, not what the socket last said.
   */
  const reconcile = useCallback(
    (events: readonly Event[]): void => {
      const said = new Set(
        events.filter((event) => event.type === 'user-said').map((event) => event.text),
      )
      const next = held.current.filter((row) => !said.has(row.text))
      if (next.length === held.current.length) return
      publish(next)
    },
    [publish],
  )

  const resolve = useCallback(
    (text: string): void => {
      const next = held.current.filter((row) => !(row.text === text && !row.failed))
      if (next.length === held.current.length) return
      publish(next)
    },
    [publish],
  )

  const reset = useCallback((): void => publish(NOTHING_SENDING), [publish])

  return { rows, add, markFailed, markAllSendingFailed, reconcile, resolve, reset }
}
