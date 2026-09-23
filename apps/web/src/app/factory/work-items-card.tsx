import { Card } from '@dltech/atlas-ui/card'
import { Table, type TableColumn } from '@dltech/atlas-ui/table'

import type { FactoryWorkItem } from '../../lib/factory-api'

type WorkItemRow = {
  id: string
  repo: string
  sourceKind: string
  status: string
  revisionCycles: number
  lastActivityAt: string
}

const COLUMNS: TableColumn<WorkItemRow>[] = [
  { key: 'repo', header: 'Repo', mono: true },
  { key: 'sourceKind', header: 'Source' },
  { key: 'status', header: 'Status' },
  { key: 'revisionCycles', header: 'Revisions', align: 'right' },
  { key: 'lastActivityAt', header: 'Last activity', muted: true },
]

const formatActivity = (value: string): string =>
  new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

type WorkItemsCardProps = {
  workItems: FactoryWorkItem[]
  organizationMissing: boolean
}

export function WorkItemsCard({ workItems, organizationMissing }: WorkItemsCardProps) {
  const rows: WorkItemRow[] = workItems.map((item) => ({
    id: item.id,
    repo: item.repo,
    sourceKind: item.sourceKind,
    status: item.status,
    revisionCycles: item.revisionCycles,
    lastActivityAt: formatActivity(item.lastActivityAt),
  }))

  return (
    <Card title="Work items" subtitle="What the factory is chewing on" padded={false}>
      {organizationMissing ? (
        <p className="p-6 text-sm text-meta">
          Select or create an active organization to see work items.
        </p>
      ) : (
        <Table
          className="rounded-none border-0"
          columns={COLUMNS}
          rows={rows}
          density="dense"
          empty={<p className="p-6 text-sm text-meta">Nothing has come in yet.</p>}
        />
      )}
    </Card>
  )
}
