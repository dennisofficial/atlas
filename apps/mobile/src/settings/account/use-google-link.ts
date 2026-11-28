import type { createApiClient } from '@dltech/atlas-api-router'
import { googleLinkMessageOf } from '@dltech/atlas-client/settings'
import { stateOfStartLink } from '@dltech/atlas-core'
import { useEffect, useRef, useState } from 'react'
import { openBrowserReturn } from '../../browser-return/open-browser-return'
import { useReturnOutcome } from '../../browser-return/use-return-outcome'

export const useGoogleLink = (args: {
  api: ReturnType<typeof createApiClient> | undefined
  reload: () => void
}) => {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ success: boolean; message: string }>()
  const outcome = useReturnOutcome({ state: stateOfStartLink(url), durable: undefined })
  const reload = useRef(args.reload)
  reload.current = args.reload

  useEffect(() => {
    if (outcome === undefined) return
    setMessage(googleLinkMessageOf(outcome))
    setBusy(false)
    reload.current()
  }, [outcome])

  const handleLink = async () => {
    if (args.api === undefined || busy) return
    setBusy(true)
    setMessage(undefined)
    try {
      const started = await args.api.googleAccount.beginLink.mutate({})
      setUrl(started.url)
      await openBrowserReturn({ url: started.url })
    } catch {
      setMessage({ success: false, message: 'Google linking could not start. Try again.' })
    } finally {
      setBusy(false)
    }
  }

  return { busy, message, handleLink }
}
