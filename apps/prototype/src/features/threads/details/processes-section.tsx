import { CircleCheckIcon, CircleIcon, CircleXIcon } from 'lucide-react'

import { DetailRow } from '@dltech/atlas-ui/ai/detail-row'

import {
  EProcessTone,
  SERVICES,
  SERVICES_HIDDEN,
  SHELLS,
  type ProcessRow,
} from './details-fixtures'
import { earlierLabelOf } from './details-model'
import { DetailsSection } from './section'

function ToneIcon({ tone }: { tone: EProcessTone }) {
  if (tone === EProcessTone.Running) {
    return <CircleIcon aria-hidden className="size-2.5 fill-current text-success" />
  }
  if (tone === EProcessTone.Failed) {
    return <CircleXIcon aria-hidden className="size-3.5 text-destructive" />
  }
  return <CircleCheckIcon aria-hidden className="size-3.5 text-muted-foreground" />
}

function Rows({ rows }: { rows: ProcessRow[] }) {
  return rows.map((row) => (
    <DetailRow
      key={row.id}
      icon={<ToneIcon tone={row.tone} />}
      label={row.name}
      meta={row.readout}
    />
  ))
}

export function ProcessesSection() {
  return (
    <>
      <DetailsSection title="Shells" count={SHELLS.length}>
        <Rows rows={SHELLS} />
      </DetailsSection>
      <DetailsSection title="Services" count={SERVICES.length}>
        <Rows rows={SERVICES} />
        <DetailRow
          label={
            <span className="text-xs text-muted-foreground">{earlierLabelOf(SERVICES_HIDDEN)}</span>
          }
        />
      </DetailsSection>
    </>
  )
}
