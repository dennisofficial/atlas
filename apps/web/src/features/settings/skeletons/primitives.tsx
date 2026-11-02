import type { ReactNode } from 'react'

import { Skeleton } from '@dltech/atlas-ui/components/skeleton'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { CONFIG_FOOTER_CLASS } from '../parts/agent-config-footer'
import { SettingsCard, SettingsRow } from '../settings-layout'

export enum ERowControl {
  None = 'none',
  Switch = 'switch',
  SmallSwitch = 'small-switch',
  Select = 'select',
  ShortSelect = 'short-select',
  Toggles = 'toggles',
  Button = 'button',
  Buttons = 'buttons',
  Input = 'input',
  Key = 'key',
  Slider = 'slider',
  SwitchMenu = 'switch-menu',
}

const BUTTON_CLASS = 'h-7 rounded-lg'

const CONTROLS: Record<ERowControl, ReactNode> = {
  [ERowControl.None]: null,
  [ERowControl.Switch]: <Skeleton className="h-[18px] w-8 rounded-full" />,
  [ERowControl.SmallSwitch]: <Skeleton className="h-3.5 w-6 rounded-full" />,
  [ERowControl.Select]: <Skeleton className="h-7 w-48 rounded-lg" />,
  [ERowControl.ShortSelect]: <Skeleton className="h-7 w-24 rounded-lg" />,
  [ERowControl.Toggles]: <Skeleton className="h-7 w-44 rounded-lg" />,
  [ERowControl.Button]: <Skeleton className={`${BUTTON_CLASS} w-20`} />,
  [ERowControl.Buttons]: (
    <>
      <Skeleton className={`${BUTTON_CLASS} w-20`} />
      <Skeleton className={`${BUTTON_CLASS} w-24`} />
    </>
  ),
  [ERowControl.Input]: <Skeleton className="h-8 w-72 max-w-full rounded-lg" />,
  [ERowControl.Key]: (
    <>
      <Skeleton className="h-8 w-56 rounded-lg" />
      <Skeleton className={`${BUTTON_CLASS} w-24`} />
    </>
  ),
  [ERowControl.SwitchMenu]: (
    <>
      <Skeleton className="h-3.5 w-6 rounded-full" />
      <Skeleton className="size-7 rounded-lg" />
    </>
  ),
  [ERowControl.Slider]: (
    <div className="flex w-56 items-center gap-3">
      <Skeleton className="h-4 flex-1" />
      <Skeleton className="h-4 w-16" />
    </div>
  ),
}

export function Line({ width, className }: { width: string; className?: string }) {
  return (
    <div className={cn('flex h-5 items-center', className)}>
      <Skeleton className={`h-3.5 ${width}`} />
    </div>
  )
}

export function TextLines({ widths }: { widths: readonly string[] }) {
  return (
    <div className="flex flex-col">
      {widths.map((width, index) => (
        <Line key={index} width={width} />
      ))}
    </div>
  )
}

const LINE_WIDTHS = ['w-full max-w-prose', 'w-2/3 max-w-md', 'w-1/2 max-w-sm']

export function SettingsRowSkeleton({
  control = ERowControl.None,
  media = false,
  lines = 1,
  titleWidth = 'w-36',
  badge = false,
  custom,
  extra,
}: {
  control?: ERowControl
  media?: boolean
  lines?: number
  titleWidth?: string
  badge?: boolean
  custom?: ReactNode
  extra?: ReactNode
}) {
  return (
    <SettingsRow
      media={media ? <Skeleton className="size-8 rounded-md" /> : undefined}
      title={
        <>
          <Line width={titleWidth} />
          {badge ? <Skeleton className="h-5 w-16 rounded-full" /> : null}
        </>
      }
      description={<TextLines widths={LINE_WIDTHS.slice(0, lines)} />}
      control={custom ?? CONTROLS[control]}
    >
      {extra}
    </SettingsRow>
  )
}

export function SettingsRowsSkeleton({
  controls,
  media = false,
  badge = false,
  lines = 1,
}: {
  controls: readonly ERowControl[]
  media?: boolean
  badge?: boolean
  lines?: number
}) {
  return controls.map((control, index) => (
    <SettingsRowSkeleton key={index} control={control} media={media} badge={badge} lines={lines} />
  ))
}

export function SaveFooterSkeleton() {
  return <Skeleton className={`${BUTTON_CLASS} w-14`} />
}

export function ConfigFooterSkeleton() {
  return (
    <div className={CONFIG_FOOTER_CLASS}>
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-4 w-20" />
        <div className="flex items-center gap-2">
          <Skeleton className={`${BUTTON_CLASS} w-16`} />
          <Skeleton className={`${BUTTON_CLASS} w-14`} />
        </div>
      </div>
    </div>
  )
}

export function RowCardSkeleton({
  controls,
  media = false,
  badge = false,
  lines = 1,
  footer,
}: {
  controls: readonly ERowControl[]
  media?: boolean
  badge?: boolean
  lines?: number
  footer?: ReactNode
}) {
  return (
    <SettingsCard {...(footer === undefined ? {} : { footer })}>
      <SettingsRowsSkeleton controls={controls} media={media} badge={badge} lines={lines} />
    </SettingsCard>
  )
}
