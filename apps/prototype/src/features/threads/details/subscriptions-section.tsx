import { Trash2Icon } from 'lucide-react'
import { useState } from 'react'

import { DetailRow } from '@dltech/atlas-ui/ai/detail-row'
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
        <DetailRow
          key={row.id}
          mono
          label={row.label}
          detail={
            <>
              {row.paused ? <span className="font-medium">Paused · </span> : null}
              {row.detail}
            </>
          }
          actions={
            <>
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
            </>
          }
        />
      ))}
    </DetailsSection>
  )
}
