import { type ThreadId } from '@dltech/atlas-core'
import { sanitizedTitle, type ThreadStorePort } from '@dltech/atlas-harness'
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

import { notify } from '../ui/notice-store'
import { cloudRenameFailureNotice } from './cloud/cloud-write-notices'
import type { AtlasApp } from './compose'
import { durableOpLog } from './durable-op-log'
import { ERenamed, type Renaming } from './session-rename'

const trace = (message: string, threadId: ThreadId, data?: Record<string, unknown>): void => {
  if (process.env.ATLAS_TRACE_TITLING === undefined) return
  durableOpLog()?.info({ source: 'titling.trace', message, threadId, ...(data === undefined ? {} : { data }) })
}

export type SessionName = {
  name: string | null
  naming: boolean
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
  const awaitedEcho = useRef<string | null>(null)
  useEffect(() => {
    trace('onRename subscribed', threadId)
    let live = true
    const forget = threads.onRename((renamed) => {
      if (renamed.threadId !== threadId) return
      trace('onRename fired', threadId, { title: renamed.title })
      setName(renamed.title)
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
    })
    return () => {
      live = false
      trace('onRename unsubscribed', threadId)
      forget()
    }
  }, [threads, threadId])

  useEffect(() => {
    setTitling(app.titling.titling({ threadId }))
    return app.titling.onTitling({ threadId, listener: setTitling })
  }, [app.titling, threadId])

  /**
   * The naming flag holds until the rename echo has actually been observed, not merely until the
   * ask returned: the echo is what streams the answer into the animation, so clearing the flag any
   * earlier strands the generating phase with no settle. `threads.rename` fires its listeners
   * synchronously, so by the time the await resumes the echo has already run the matching branch in
   * the listener above and cleared the flag itself.
   */
  const renameThroughStore = useCallback(
    async (generated: string | null, clear: () => void): Promise<Renaming> => {
      if (generated === null) {
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
      return { type: ERenamed.Renamed, name: generated }
    },
    [threads, threadId],
  )

  const nameFromTranscript = useCallback(async (): Promise<Renaming> => {
    const digest = await readDigest()
    if (digest.trim().length === 0) return { type: ERenamed.Empty }

    setNaming(true)
    const generated = await app.titler({ text: digest }).catch(() => null)
    return renameThroughStore(generated, () => setNaming(false))
  }, [app, readDigest, renameThroughStore])

  const renameSession = useCallback(
    async (argumentText: string): Promise<Renaming> => {
      if (!started.current) return { type: ERenamed.Empty }

      const given = sanitizedTitle(argumentText)
      if (given !== null) {
        setNaming(true)
        return renameThroughStore(given, () => setNaming(false))
      }

      return nameFromTranscript()
    },
    [nameFromTranscript, renameThroughStore, started],
  )

  return { name, naming: naming || titling, setName, renameSession }
}
