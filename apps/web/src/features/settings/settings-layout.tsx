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
        <header className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold">{title}</h1>
            {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
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
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-medium">{title}</h2>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  )
}

export function SettingsCard({
  className,
  footer,
  children,
}: {
  className?: string
  footer?: ReactNode
  children: ReactNode
}) {
  return (
    <div
      className={cn('overflow-hidden rounded-lg border bg-card text-card-foreground', className)}
    >
      <div className="divide-y">{children}</div>
      {footer ? (
        <div className="flex items-center justify-end gap-2 border-t bg-muted/30 px-4 py-2.5">
          {footer}
        </div>
      ) : null}
    </div>
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
    <div className={cn('flex flex-col gap-3 px-4 py-3.5', className)}>
      <div className="flex items-center gap-3">
        {media ? <div className="flex shrink-0 items-center">{media}</div> : null}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-2 text-sm font-medium">{title}</div>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {control ? <div className="flex shrink-0 items-center gap-2">{control}</div> : null}
      </div>
      {children}
    </div>
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
      <SettingsCard className="border-destructive/30">
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
