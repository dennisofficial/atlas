'use client'

import { useMemo } from 'react'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@dltech/atlas-ui/components/select'

import { useGroups } from '@/features/groups/data/use-groups'
import { runAction } from '@/features/settings/data/shared/run-action'
import { EQueryState } from '@/lib/use-cloud-query'

const NO_GROUP = 'none'

export function GroupPicker({
  projectId,
  groupId,
  onAssigned,
}: {
  projectId: string
  groupId: string | null
  onAssigned: () => void
}) {
  const groups = useGroups()
  const options = groups.query.state === EQueryState.Ready ? groups.query.data : []
  const items = useMemo(
    () => [
      { value: NO_GROUP, label: 'No group' },
      ...options.map((group) => ({ value: group.id, label: group.name })),
    ],
    [options],
  )

  const handleValueChange = (next: string | null) => {
    if (next === null || next === (groupId ?? NO_GROUP)) return
    void runAction({
      work: () => groups.assign({ projectId, groupId: next === NO_GROUP ? null : next }),
      success: 'Group saved',
    }).then(() => onAssigned())
  }

  return (
    <Select items={items} value={groupId ?? NO_GROUP} onValueChange={handleValueChange}>
      <SelectTrigger aria-label="Project group" className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} className="min-w-[var(--anchor-width)]">
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
