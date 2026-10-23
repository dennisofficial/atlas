import { Checkbox } from '@dltech/atlas-ui/components/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@dltech/atlas-ui/components/table'

import {
  ENotifyChannel,
  NOTIFY_EVENTS,
  type NotifyMatrix,
} from '../../../fixtures/settings-interface'

const COLUMNS = [
  { channel: ENotifyChannel.InApp, label: 'In-app' },
  { channel: ENotifyChannel.Push, label: 'Push' },
  { channel: ENotifyChannel.Email, label: 'Email' },
]

export function NotifyMatrixTable({
  matrix,
  onToggle,
}: {
  matrix: NotifyMatrix
  onToggle: (params: { eventId: string; channel: ENotifyChannel; checked: boolean }) => void
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="h-9 px-4 text-xs font-normal text-muted-foreground">
            Event
          </TableHead>
          {COLUMNS.map((column) => (
            <TableHead
              key={column.channel}
              className="h-9 w-20 px-4 text-center text-xs font-normal text-muted-foreground"
            >
              {column.label}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {NOTIFY_EVENTS.map((event) => (
          <TableRow key={event.id}>
            <TableCell className="px-4 py-3">
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">{event.title}</span>
                <span className="text-xs text-muted-foreground">{event.description}</span>
              </div>
            </TableCell>
            {COLUMNS.map((column) => (
              <TableCell key={column.channel} className="px-4 py-3">
                <div className="flex justify-center">
                  <Checkbox
                    checked={matrix[event.id]?.[column.channel] ?? false}
                    onCheckedChange={(checked) =>
                      onToggle({ eventId: event.id, channel: column.channel, checked })
                    }
                    aria-label={`${event.title} · ${column.label}`}
                  />
                </div>
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
