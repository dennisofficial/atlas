'use client'

import Link from 'next/link'
import { ArrowUpRightIcon } from 'lucide-react'
import { Fragment, type ReactNode } from 'react'

import { type EConfigLayer } from '@dltech/atlas-core'
import { Badge } from '@dltech/atlas-ui/components/badge'
import { Button } from '@dltech/atlas-ui/components/button'
import { Card, CardRow } from '@dltech/atlas-ui/components/card'

import { inheritedTitleOf, overriddenLabelOf, type LayerRef } from '@dltech/atlas-client/settings'

export type LayeredGroup<T> = LayerRef & { items: readonly T[] }

const INHERITED_DESCRIPTION = 'Inherited unless a higher layer sets the same thing.'

export function OverriddenBadge({ shadow }: { shadow: EConfigLayer }) {
  return <Badge variant="outline">{overriddenLabelOf(shadow)}</Badge>
}

export function InheritedRow({
  shadow,
  children,
}: {
  shadow: EConfigLayer | null
  children: ReactNode
}) {
  return (
    <CardRow
      className={shadow === null ? 'flex-row items-center' : 'flex-row items-center opacity-60'}
    >
      {children}
    </CardRow>
  )
}

export function InheritedLayers<T>({
  layers,
  keyOf,
  editHrefOf,
  renderRow,
}: {
  layers: readonly LayeredGroup<T>[]
  keyOf: (item: T) => string
  editHrefOf?: (args: LayerRef) => string | null
  renderRow: (args: LayerRef & { item: T }) => ReactNode
}) {
  const visible = layers.filter((entry) => entry.items.length > 0)
  if (visible.length === 0) return null
  return (
    <div className="flex flex-col gap-6">
      {visible.map((entry) => {
        const href = editHrefOf === undefined ? null : editHrefOf(entry)
        return (
          <section key={entry.layer} className="flex flex-col gap-3">
            <div className="flex items-end justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <h2 className="text-sm font-medium">{inheritedTitleOf(entry)}</h2>
                <p className="text-sm text-muted-foreground">{INHERITED_DESCRIPTION}</p>
              </div>
              {href === null ? null : (
                <Button
                  variant="ghost"
                  size="sm"
                  nativeButton={false}
                  render={<Link href={href} />}
                >
                  Edit
                  <ArrowUpRightIcon data-icon="inline-end" />
                </Button>
              )}
            </div>
            <Card variant="list">
              {entry.items.map((item) => (
                <Fragment key={keyOf(item)}>
                  {renderRow({ layer: entry.layer, owner: entry.owner, item })}
                </Fragment>
              ))}
            </Card>
          </section>
        )
      })}
    </div>
  )
}
