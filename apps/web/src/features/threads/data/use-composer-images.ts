import { useCallback, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import {
  chipOf,
  isOverBudget,
  planAttach,
  TOAST_IMAGES_TOO_LARGE,
  TOAST_ONLY_IMAGES,
  TOAST_TOO_MANY_IMAGES,
  TOAST_UNREADABLE_IMAGE,
  type HeldImage,
} from './composer-images'
import { encodeImage } from './image-encode'

export function useComposerImages() {
  const [held, setHeld] = useState<HeldImage[]>([])
  const [encoding, setEncoding] = useState(0)
  const heldRef = useRef<HeldImage[]>([])
  const inFlight = useRef(0)
  const sequence = useRef(0)

  const commit = useCallback((next: HeldImage[]) => {
    heldRef.current = next
    setHeld(next)
  }, [])

  const attach = useCallback(
    async (files: File[]): Promise<void> => {
      const plan = planAttach({
        files,
        held: heldRef.current.length + inFlight.current,
      })
      if (plan.droppedNonImage) toast.error(TOAST_ONLY_IMAGES)
      if (plan.droppedOverflow) toast.error(TOAST_TOO_MANY_IMAGES)
      if (plan.accepted.length === 0) return
      inFlight.current += plan.accepted.length
      setEncoding((count) => count + plan.accepted.length)
      const results = await Promise.allSettled(
        plan.accepted.map((file) => {
          sequence.current += 1
          return encodeImage({ file, index: sequence.current })
        }),
      )
      inFlight.current -= plan.accepted.length
      setEncoding((count) => count - plan.accepted.length)
      const added = results.flatMap((result) =>
        result.status === 'fulfilled' ? [{ id: crypto.randomUUID(), image: result.value }] : [],
      )
      if (added.length < results.length) toast.error(TOAST_UNREADABLE_IMAGE)
      if (added.length > 0) commit([...heldRef.current, ...added])
    },
    [commit],
  )

  const remove = useCallback(
    (id: string) => commit(heldRef.current.filter((entry) => entry.id !== id)),
    [commit],
  )

  const clear = useCallback(() => commit([]), [commit])

  const images = useMemo(() => held.map((entry) => entry.image), [held])
  const attachments = useMemo(() => held.map(chipOf), [held])
  const overBudget = isOverBudget(images)

  const checkBudget = (): boolean => {
    if (overBudget) toast.error(TOAST_IMAGES_TOO_LARGE)
    return !overBudget
  }

  return {
    images,
    encoding: encoding > 0,
    overBudget,
    attach,
    remove,
    clear,
    checkBudget,
    composerProps: {
      attachments,
      onAttachFiles: (files: File[]) => void attach(files),
      onRemoveAttachment: remove,
    },
  }
}
