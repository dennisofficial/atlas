import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import type { CommandEntry } from '@dltech/atlas-commands'
import { surfaceCommands } from '@dltech/atlas-core'

import { requestOpenSearch } from '../../shell/search-events'
import { dispatchSubmission, EDispatch } from './dispatch'
import { newThreadCommandHandlers } from './new-thread-command-handlers'
import { useCatalogueSkills } from './use-catalogue-skills'
import { menuEntryOfSpec } from './v1-entries'

export function useNewThreadCommands(args: { clearDraft: () => void }) {
  const [modelOpen, setModelOpen] = useState(false)
  const router = useRouter()
  const catalogue = useCatalogueSkills()
  const { clearDraft } = args
  const { reload } = catalogue

  const handlers = useMemo(
    () =>
      newThreadCommandHandlers({
        openModelPicker: () => setModelOpen(true),
        openSearch: requestOpenSearch,
        navigate: (href) => router.push(href),
        clearDraft,
        reloadSkills: async () => (await reload()).length,
      }),
    [router, clearDraft, reload],
  )
  const commands = useMemo(() => surfaceCommands({ handlers }), [handlers])
  const entries = useMemo<readonly CommandEntry[]>(
    () => [...commands, ...catalogue.skills].map(menuEntryOfSpec),
    [commands, catalogue.skills],
  )

  const handleCommand = async (text: string): Promise<boolean> => {
    const result = await dispatchSubmission({
      text,
      handlers,
      commands,
      skills: catalogue.skills,
      working: false,
    })
    if (result.type === EDispatch.Send) return false
    if (result.type === EDispatch.Refused) toast.error(result.reason)
    else if (result.notice !== undefined) toast(result.notice)
    return true
  }

  return { entries, handleCommand, modelOpen, setModelOpen }
}
