import { CircleCheckIcon, CircleIcon, CircleXIcon } from 'lucide-react'

import {
  EProcessTone,
  SERVICES,
  SERVICES_HIDDEN,
  SHELLS,
  type ProcessRow,
} from './details-fixtures'
import { earlierLabelOf } from './details-model'
import { DetailsSection, StaticRow } from './section'

function ToneIcon({ tone }: { tone: EProcessTone }) {
  if (tone === EProcessTone.Running) {
    return <CircleIcon aria-hidden className="size-2.5 shrink-0 fill-current text-success" />
  }
  if (tone === EProcessTone.Failed) {
    return <CircleXIcon aria-hidden className="size-3.5 shrink-0 text-destructive" />
  }
  return <CircleCheckIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
}

function Rows({ rows }: { rows: ProcessRow[] }) {
  return rows.map((row) => (
    <StaticRow key={row.id}>
      <ToneIcon tone={row.tone} />
      <span className="min-w-0 flex-1 truncate">{row.name}</span>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{row.readout}</span>
    </StaticRow>
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
        <StaticRow>
          <span className="text-xs text-muted-foreground">{earlierLabelOf(SERVICES_HIDDEN)}</span>
        </StaticRow>
      </DetailsSection>
    </>
  )
}
