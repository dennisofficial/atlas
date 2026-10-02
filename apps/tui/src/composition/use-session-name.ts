import { type ThreadId } from '@dltech/atlas-core'
import { sanitizedTitle, type ThreadStorePort } from '@dltech/atlas-harness'
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

import { NAMING_ANIMATION_MS } from '../ui/hooks/use-naming-animation'
import { ENoticeTone, notify } from '../ui/notice-store'
import { cloudRenameFailureNotice } from './cloud/cloud-write-notices'
import type { AtlasApp } from './compose'
import { durableOpLog } from './durable-op-log'
import { messageOf } from './error-text'
import { ERenamed, type Renaming } from './session-rename'

const trace = (message: string, threadId: ThreadId, data?: Record<string, unknown>): void => {
  if (process.env.ATLAS_TRACE_TITLING === undefined) return
  durableOpLog()?.info({ source: 'titling.trace', message, threadId, ...(data === undefined ? {} : { data }) })
}

/** A rename in flight: the name on screen when it started, and the answer once it resolves. The
 *  animation reads both halves off this one object so a fast rename — where the answer arrives in
 *  the same commit the request appears — still begins from the old name and streams into the new. */
export type NamingRequest = { from: string | null; answer: string | null }

export type SessionName = {
  name: string | null
  naming: boolean
  /** The live `/rename`, set when the ask starts and held for a settle window after it resolves. */
  namingRequest: NamingRequest | null
  setName: (name: string | null) => void
  renameSession: (argumentText: string) => Promise<Renaming>
}

/**
 * First-message titling is the composition root's (the TitlingTurnRunner titles every session
 * kind, serve included); what stays here is `/rename`, the deliberate second pass: it is awaited,
 * it reads the whole session rather than its opening line, and a name the operator typed wins
 * outright. Every rename that goes through the thread store — the root's titling pass included —
 * republishes `name` through the store's `onRename`, so this hook never writes `name` for its own
 * `/rename`: it asks the store and takes the echo back like any other listener. `setName` remains
 * for a thread swap, where the newly opened thread's name arrives with it rather than as a rename.
 */
export function useSessionName(args: {
  app: AtlasApp
  /** The store the rename crosses — the cloud attachment's when the thread is lifted. */
  threads?: ThreadStorePort | undefined
  threadId: ThreadId
  started: RefObject<boolean>
  readDigest: () => Promise<string>
  initial: string | null
}): SessionName {
  const { app, threadId, started, readDigest } = args
  const threads = args.threads ?? app.threads
  const [name, setName] = useState<string | null>(args.initial)
  const [naming, setNaming] = useState(false)
  const [titling, setTitling] = useState(false)
  const [namingRequest, setNamingRequest] = useState<NamingRequest | null>(null)
  const requestTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const awaitedEcho = useRef<string | null>(null)
  const titlingRef = useRef(false)
  useEffect(() => {
    trace('onRename subscribed', threadId)
    let live = true
    const forget = threads.onRename((renamed) => {
      if (renamed.threadId !== threadId) return
      trace('onRename fired', threadId, { title: renamed.title })
      setName(renamed.title)
      /**
       * First titling renames through the store without a `namingRequest`, so the answer lands here
       * rather than in `renameThroughStore`. While the titler is in flight, that echo is the
       * animation's stream: from the neutral opening the `titling` watcher armed, into the title.
       */
      if (titlingRef.current) {
        setNamingRequest((current) =>
          current === null || current.answer !== null ? current : { ...current, answer: renamed.title },
        )
        if (requestTimer.current !== null) clearTimeout(requestTimer.current)
        requestTimer.current = setTimeout(() => setNamingRequest(null), NAMING_ANIMATION_MS)
      }
      if (awaitedEcho.current === renamed.title) {
        awaitedEcho.current = null
        setNaming(false)
      }
    })
    void threads.find({ threadId }).then((thread) => {
      const title = thread?.title
      if (!live || title === undefined) return
      setName((current) => {
        if (current !== null) return current
        trace('recovered missed rename', threadId, { title })
        return title
      })
    }).catch(() => undefined)
    return () => {
      live = false
      trace('onRename unsubscribed', threadId)
      forget()
    }
  }, [threads, threadId])

  /**
   * First titling is the same animation as `/rename`, armed off the titling flag rather than the
   * rename request: the rise begins the generating phase from no name, the store's echo streams the
   * answer in (handled in the `onRename` listener), and a fall with no answer — a titler that
   * declined, failed, or found the thread already named — ends it rather than holding noise forever.
   */
  useEffect(() => {
    const handleTitling = (next: boolean): void => {
      titlingRef.current = next
      setTitling(next)
      if (next) {
        setNamingRequest((current) => current ?? { from: null, answer: null })
        return
      }
      setNamingRequest((current) =>
        current !== null && current.answer === null && current.from === null ? null : current,
      )
    }
    handleTitling(app.titling.titling({ threadId }))
    return app.titling.onTitling({ threadId, listener: handleTitling })
  }, [app.titling, threadId])

  useEffect(
    () => () => {
      if (requestTimer.current !== null) clearTimeout(requestTimer.current)
    },
    [],
  )

  /**
   * The rename resolves into `namingRequest.answer` and holds the whole request until the animation
   * has finished, so the animation always sees the pair — the name it started from and the answer
   * to stream — no matter how fast the store echoes. The hold must outlast the animation's whole
   * lifecycle (the minimum generating window plus the settle sweep): clearing it earlier ends the
   * animation mid-stream and the title snaps. Clearing the request is what hands the surface back
   * to the settled title.
   */
  const renameThroughStore = useCallback(
    async (generated: string | null, clear: () => void): Promise<Renaming> => {
      if (generated === null) {
        setNamingRequest(null)
        clear()
        return { type: ERenamed.Declined }
      }
      awaitedEcho.current = generated
      trace('rename asked', threadId, { title: generated })
      await threads.rename({ threadId, title: generated }).catch(() => notify(cloudRenameFailureNotice()))
      trace('rename returned', threadId, { title: generated, pending: awaitedEcho.current })
      if (awaitedEcho.current === generated) {
        awaitedEcho.current = null
        clear()
      }
      setNamingRequest((current) => (current === null ? null : { ...current, answer: generated }))
      if (requestTimer.current !== null) clearTimeout(requestTimer.current)
      requestTimer.current = setTimeout(() => setNamingRequest(null), NAMING_ANIMATION_MS)
      return { type: ERenamed.Renamed, name: generated }
    },
    [threads, threadId],
  )

  const beginRename = useCallback(() => {
    if (requestTimer.current !== null) clearTimeout(requestTimer.current)
    setNamingRequest({ from: name, answer: null })
    setNaming(true)
  }, [name])

  const nameFromTranscript = useCallback(async (): Promise<Renaming> => {
    const digest = await readDigest().catch((failure: unknown): string | null => {
      notify({
        key: 'rename-transcript-read',
        tone: ENoticeTone.Warn,
        text: `the rename could not read the transcript — ${messageOf(failure)}`,
      })
      return null
    })
    if (digest === null) return { type: ERenamed.Declined }
    if (digest.trim().length === 0) return { type: ERenamed.Empty }

    beginRename()
    const generated = await app.titler({ text: digest }).catch(() => null)
    return renameThroughStore(generated, () => setNaming(false))
  }, [app, beginRename, readDigest, renameThroughStore])

  const renameSession = useCallback(
    async (argumentText: string): Promise<Renaming> => {
      if (!started.current) return { type: ERenamed.Empty }

      const given = sanitizedTitle(argumentText)
      if (given !== null) {
        beginRename()
        return renameThroughStore(given, () => setNaming(false))
      }

      return nameFromTranscript()
    },
    [nameFromTranscript, renameThroughStore, started],
  )

  return { name, naming: naming || titling, namingRequest, setName, renameSession }
}
