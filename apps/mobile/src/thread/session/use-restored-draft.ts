import type { Attachment } from '@dltech/atlas-core'
import { useCallback, useRef, useState } from 'react'

export type RestoredDraft = { token: number; text: string; attachments: readonly Attachment[] }

export const useRestoredDraft = (): {
  restored: RestoredDraft | undefined
  restore: (draft: { text: string; attachments: readonly Attachment[] }) => void
} => {
  const [restored, setRestored] = useState<RestoredDraft | undefined>(undefined)
  const token = useRef(0)
  const restore = useCallback((draft: { text: string; attachments: readonly Attachment[] }) => {
    token.current += 1
    setRestored({ token: token.current, ...draft })
  }, [])
  return { restored, restore }
}
