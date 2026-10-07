import { ESettingPage, type EventLogPort, type QualityHealth, type ThreadId } from '@dltech/atlas-core'
import { readQualityHealth, type DeltaChannel } from '@dltech/atlas-harness'
import { useEffect, useRef, useState } from 'react'

import { currentPage, type SettingsModel, type SettingsState } from '../ui/settings-model'

export enum EQualityHealthReadKind {
  Loading = 'loading',
  Ready = 'ready',
  Unavailable = 'unavailable',
}

export type QualityHealthRead =
  | { kind: EQualityHealthReadKind.Loading }
  | { kind: EQualityHealthReadKind.Ready; health: QualityHealth }
  | {
      kind: EQualityHealthReadKind.Unavailable
      lastKnown: QualityHealth | null
      reason: string
    }

type QualityHealthSource = {
  log: Pick<EventLogPort, 'head' | 'readOwn'>
  channel: Pick<DeltaChannel, 'subscribe'>
}

const settingsOnQualityPage = (args: {
  state: SettingsState | null
  model: SettingsModel
}): boolean =>
  args.state !== null &&
  currentPage({ state: args.state, model: args.model })?.page.id === ESettingPage.CodeQuality

const failureText = (cause: unknown): string =>
  cause instanceof Error ? cause.message : 'the thread log could not be read'

const REFRESH_SIGNALS = new Set(['events-appended', 'step-started', 'step-ended'])

export function useQualityHealth(args: {
  app: QualityHealthSource
  state: SettingsState | null
  model: SettingsModel
  threadId: ThreadId
}): QualityHealthRead {
  const visible = settingsOnQualityPage({ state: args.state, model: args.model })
  const [read, setRead] = useState<QualityHealthRead>({ kind: EQualityHealthReadKind.Loading })

  const generation = useRef(0)
  const inFlight = useRef(false)
  const pending = useRef(false)
  const lastHead = useRef<number | null>(null)
  const held = useRef<QualityHealth | null>(null)

  useEffect(() => {
    if (!visible) return

    const mine = (generation.current += 1)
    lastHead.current = null
    held.current = null
    setRead({ kind: EQualityHealthReadKind.Loading })

    const refresh = async (): Promise<void> => {
      if (inFlight.current) {
        pending.current = true
        return
      }
      inFlight.current = true

      try {
        const head = await args.app.log.head({ threadId: args.threadId })
        if (generation.current !== mine) return

        if (head === lastHead.current) {
          const lastKnown = held.current
          setRead((current) =>
            lastKnown === null || current.kind === EQualityHealthReadKind.Ready
              ? current
              : { kind: EQualityHealthReadKind.Ready, health: lastKnown },
          )
          return
        }

        const health = await readQualityHealth({ log: args.app.log, threadId: args.threadId })
        if (generation.current !== mine) return

        lastHead.current = head
        held.current = health
        setRead((current) =>
          current.kind === EQualityHealthReadKind.Ready && current.health === health
            ? current
            : { kind: EQualityHealthReadKind.Ready, health },
        )
      } catch (cause) {
        if (generation.current !== mine) return
        setRead({
          kind: EQualityHealthReadKind.Unavailable,
          lastKnown: held.current,
          reason: failureText(cause),
        })
      } finally {
        if (generation.current === mine) {
          inFlight.current = false
          if (pending.current) {
            pending.current = false
            void refresh()
          }
        }
      }
    }

    void refresh()

    const unsubscribe = args.app.channel.subscribe({
      threadId: args.threadId,
      listener: (signal) => {
        if (!REFRESH_SIGNALS.has(signal.type) || generation.current !== mine) return
        void refresh()
      },
    })

    return () => {
      generation.current += 1
      unsubscribe()
      inFlight.current = false
      pending.current = false
    }
  }, [visible, args.app, args.threadId])

  return read
}
