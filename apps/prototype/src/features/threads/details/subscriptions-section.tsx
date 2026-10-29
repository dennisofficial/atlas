import { Trash2Icon } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'
import { Switch } from '@dltech/atlas-ui/components/switch'

import { SUBSCRIPTIONS } from './details-fixtures'
import { DetailsSection } from './section'

export function SubscriptionsSection() {
  const [rows, setRows] = useState(SUBSCRIPTIONS)
  if (rows.length === 0) return null

  const handlePaused = ({ id, paused }: { id: string; paused: boolean }) =>
    setRows((held) => held.map((row) => (row.id === id ? { ...row, paused } : row)))
  const handleRemove = (id: string) => setRows((held) => held.filter((row) => row.id !== id))

  return (
    <DetailsSection title="Subscriptions" count={rows.length}>
      {rows.map((row) => (
        <div key={row.id} className="flex items-center gap-2 px-1 py-0.5">
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-mono text-sm">{row.label}</span>
            <span className="truncate text-xs text-muted-foreground">
              {row.paused ? <span className="font-medium">Paused · </span> : null}
              {row.detail}
            </span>
          </div>
          <Switch
            size="sm"
            checked={!row.paused}
            aria-label={`${row.paused ? 'Resume' : 'Pause'} ${row.label}`}
            onCheckedChange={(checked) => handlePaused({ id: row.id, paused: !checked })}
          />
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Remove ${row.label}`}
            className="text-muted-foreground"
            onClick={() => handleRemove(row.id)}
          >
            <Trash2Icon />
          </Button>
        </div>
      ))}
    </DetailsSection>
  )
}
