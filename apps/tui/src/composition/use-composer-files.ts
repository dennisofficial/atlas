import { useMemo } from 'react'

import { activeMentionReader, rebaseMentionReader } from '@dltech/atlas-harness'

import type { AtlasApp } from './compose'
import { useSessionOwner } from './use-session-owner'

export function useComposerFiles(args: {
  app: Pick<AtlasApp, 'files' | 'sessionOwner'>
  projectDirectory: string
}) {
  const owner = useSessionOwner({ app: args.app })
  const reader = activeMentionReader({
    reader: args.app.files,
    location: owner.location,
    bound: owner.bound,
  })
  const files = useMemo(
    () => rebaseMentionReader({ reader, root: args.projectDirectory }),
    [reader, args.projectDirectory, owner.location],
  )
  return { reader, files }
}
