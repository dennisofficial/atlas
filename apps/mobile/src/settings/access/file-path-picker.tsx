import { pickerChoices } from '@dltech/atlas-client/settings'
import { useState } from 'react'

import { useAuth } from '../../auth/auth-provider'
import { ActionRow, NavRow, Section, StatusRows } from '../settings-parts'
import { useApiResource } from '../use-api-resource'
import { AccessNote } from './access-parts'

export const FilePathPicker = ({
  projectId,
  path,
  onChange,
}: {
  projectId: string
  path: string
  onChange: (path: string) => void
}) => {
  const { api } = useAuth()
  const [open, setOpen] = useState(false)
  const tree = useApiResource({
    load: async () => {
      if (api === undefined) throw new Error('Not signed in')
      return (await api.projectResources.repoTree.query({ projectId })).entries
    },
    deps: [api, projectId],
  })
  const choices = pickerChoices({ entries: tree.data ?? [], query: path })
  return (
    <Section title="Repository paths">
      <ActionRow
        label={open ? 'Cancel path picker' : 'Choose repository path'}
        onPress={() => setOpen(!open)}
      />
      {open ? (
        <>
          <StatusRows
            state={tree.state}
            onRetry={tree.reload}
            failure="Repository paths could not be loaded. You can type a path instead."
          />
          {tree.data === null ? null : choices.length === 0 ? (
            <AccessNote text="No matching paths. Type a new path above, or clear it to browse the repository." />
          ) : (
            choices.map((choice) => (
              <NavRow
                key={choice}
                label={choice}
                onPress={() => {
                  onChange(choice)
                  setOpen(choice.endsWith('/'))
                }}
              />
            ))
          )}
        </>
      ) : null}
    </Section>
  )
}
