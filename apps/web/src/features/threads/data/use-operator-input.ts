import { useState } from 'react'
import { toast } from 'sonner'

import { submitOperatorInput } from './operator-input-submit'
import type { ThreadSource } from './thread-source'

export function useOperatorInput(source: Pick<ThreadSource, 'channel' | 'operatorInput'>) {
  const { channel, operatorInput } = source
  const [submittingId, setSubmittingId] = useState<string | null>(null)

  const handleSubmit = async (value: string) => {
    if (operatorInput === null) return
    const { requestId } = operatorInput
    setSubmittingId(requestId)
    const notice = await submitOperatorInput({ channel, requestId, value })
    setSubmittingId((current) => (current === requestId ? null : current))
    if (notice !== null) toast.error(notice)
  }

  return {
    request: operatorInput,
    submitting: operatorInput !== null && submittingId === operatorInput.requestId,
    handleSubmit,
  }
}
