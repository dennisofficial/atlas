import { toast } from 'sonner'

import { EGithubPrStatesFrame, type GithubPrStatesFrame } from '@dltech/atlas-wire/web'

export type PrObservationStatus = Extract<
  GithubPrStatesFrame,
  { type: EGithubPrStatesFrame.ObservationStatus }
>

const UNAVAILABLE =
  'Live pull request checks are temporarily unavailable. Cached checks may be stale.'

export function createPrObservationNotifier(notify: {
  warn: (message: string) => void
  clear: () => void
}) {
  let message: string | null = null
  return (status: PrObservationStatus | null) => {
    const next = status?.available === false ? status.message?.trim() || UNAVAILABLE : null
    if (next === message) return
    message = next
    if (next === null) notify.clear()
    else notify.warn(next)
  }
}

const notifiers = new WeakMap<object, ReturnType<typeof createPrObservationNotifier>>()
let nextId = 0

export function notifyPrObservationStatus(args: {
  source: object
  status: PrObservationStatus | null
}) {
  let notify = notifiers.get(args.source)
  if (notify === undefined) {
    const id = `pr-observation-${nextId++}`
    notify = createPrObservationNotifier({
      warn: (message) => {
        toast.warning(message, { id, duration: Number.POSITIVE_INFINITY })
      },
      clear: () => {
        toast.dismiss(id)
      },
    })
    notifiers.set(args.source, notify)
  }
  notify(args.status)
}
