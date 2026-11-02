'use client'

import type { ReactNode } from 'react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@dltech/atlas-ui/components/alert-dialog'
import { Button } from '@dltech/atlas-ui/components/button'
import { Card, CardFooter, CardRow } from '@dltech/atlas-ui/components/card'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { PageStatusSlot } from './status/page-status-scope'

export function SettingsPage({
  title,
  description,
  actions,
  children,
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="text-lg font-semibold">{title}</h1>
            {description ? (
              <div className="text-sm text-muted-foreground">{description}</div>
            ) : null}
          </div>
          {actions ? (
            <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{actions}</div>
          ) : null}
        </header>
        <PageStatusSlot />
      </div>
      {children}
    </div>
  )
}

export function SettingsSection({
  title,
  description,
  actions,
  children,
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-sm font-medium">{title}</h2>
          {description ? <div className="text-sm text-muted-foreground">{description}</div> : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{actions}</div>
        ) : null}
      </div>
      {children}
    </section>
  )
}

export function SettingsCard({
  className,
  footer,
  tone,
  children,
}: {
  className?: string
  footer?: ReactNode
  tone?: 'default' | 'destructive'
  children: ReactNode
}) {
  return (
    <Card variant="list" tone={tone} className={className}>
      {children}
      {footer ? <CardFooter className="justify-end">{footer}</CardFooter> : null}
    </Card>
  )
}

export function SettingsRow({
  title,
  description,
  media,
  control,
  children,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  media?: ReactNode
  control?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <CardRow className={className}>
      <div className="flex flex-wrap items-center gap-3">
        {media ? <div className="flex shrink-0 items-center">{media}</div> : null}
        <div className="flex min-w-48 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-2 text-sm font-medium">{title}</div>
          {description ? <div className="text-sm text-muted-foreground">{description}</div> : null}
        </div>
        {control ? (
          <div className="flex max-w-full min-w-0 flex-wrap items-center gap-2">{control}</div>
        ) : null}
      </div>
      {children}
    </CardRow>
  )
}

export function SaveFooter({
  dirty,
  onDiscard,
  onSave,
  saveLabel = 'Save',
}: {
  dirty: boolean
  onDiscard: () => void
  onSave: () => void
  saveLabel?: string
}) {
  return (
    <>
      {dirty ? (
        <Button variant="ghost" size="sm" onClick={onDiscard}>
          Discard
        </Button>
      ) : null}
      <Button size="sm" disabled={!dirty} onClick={onSave}>
        {saveLabel}
      </Button>
    </>
  )
}

export type DangerAction = {
  title: string
  description: string
  buttonLabel: string
  confirmTitle: string
  confirmDescription: string
  onConfirm?: () => void
}

export function DangerZone({ actions }: { actions: DangerAction[] }) {
  return (
    <SettingsSection title="Danger zone">
      <SettingsCard tone="destructive">
        {actions.map((action) => (
          <SettingsRow
            key={action.title}
            title={action.title}
            description={action.description}
            control={
              <AlertDialog>
                <AlertDialogTrigger render={<Button variant="outline" size="sm" />}>
                  {action.buttonLabel}
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{action.confirmTitle}</AlertDialogTitle>
                    <AlertDialogDescription>{action.confirmDescription}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={action.onConfirm}>
                      {action.buttonLabel}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            }
          />
        ))}
      </SettingsCard>
    </SettingsSection>
  )
}

export function Mono({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cn('font-mono text-xs tabular-nums', className)}>{children}</span>
}
