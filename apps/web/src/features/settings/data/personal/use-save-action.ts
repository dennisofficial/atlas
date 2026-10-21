'use client'

import { useCallback, useState } from 'react'
import { toast } from 'sonner'

import { errorMessageOf } from './error-message'

export function useSaveAction(): {
  saving: boolean
  run: (args: { work: () => Promise<void>; success?: string }) => Promise<boolean>
} {
  const [saving, setSaving] = useState(false)
  const run = useCallback(async (args: { work: () => Promise<void>; success?: string }) => {
    setSaving(true)
    try {
      await args.work()
      if (args.success !== undefined) toast.success(args.success)
      return true
    } catch (error) {
      toast.error(errorMessageOf(error))
      return false
    } finally {
      setSaving(false)
    }
  }, [])
  return { saving, run }
}
