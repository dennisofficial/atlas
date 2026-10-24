import { useId, type ReactNode } from 'react'

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
import { Label } from '@dltech/atlas-ui/components/label'
import { cn } from '@dltech/atlas-ui/lib/utils'

export enum ERowLayout {
  Inline = 'inline',
  Stacked = 'stacked',
}

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
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold">{title}</h1>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      {children}
    </div>
  )
}

export function SettingsSection({
  title,
  description,
  count,
  actions,
  children,
}: {
  title: string
  description?: ReactNode
  count?: number
  actions?: ReactNode
  children: ReactNode
}) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex max-w-prose flex-col gap-0.5">
          <h2 id={headingId} className="text-sm font-medium">
            {title}
            {count === undefined ? null : (
              <span className="ml-2 font-mono text-xs text-muted-foreground">{count}</span>
            )}
          </h2>
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
  htmlFor,
  layout = ERowLayout.Inline,
}: {
  title: ReactNode
  description?: ReactNode
  media?: ReactNode
  control?: ReactNode
  children?: ReactNode
  className?: string
  htmlFor?: string
  layout?: ERowLayout
}) {
  const stacked = layout === ERowLayout.Stacked
  const hasField = Boolean(children) && !stacked && !control && !media
  const hasBelow = Boolean(children) && !hasField

  return (
    <div className={cn('flex flex-col gap-3 px-4 py-3.5', className)}>
      <div
        className={cn(
          'flex gap-3',
          hasField
            ? 'flex-col sm:flex-row sm:items-center sm:justify-between sm:gap-8'
            : 'flex-wrap items-center',
        )}
      >
        {media ? <div className="flex shrink-0 items-center">{media}</div> : null}
        <div className="flex min-w-48 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-2 text-sm font-medium">
            {htmlFor ? <Label htmlFor={htmlFor}>{title}</Label> : title}
          </div>
          {description ? (
            <p className="max-w-prose text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {control ? <div className="flex max-w-full items-center gap-2">{control}</div> : null}
        {hasField ? (
          <div className="flex min-w-0 items-center gap-2 sm:w-96 sm:shrink-0 sm:justify-end">
            {children}
          </div>
        ) : null}
      </div>
      {hasBelow ? (
        stacked ? (
          <div className="flex min-w-0 flex-col items-stretch gap-2">{children}</div>
        ) : (
          children
        )
      ) : null}
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

export function MonogramTile({ label, className }: { label: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-sm font-semibold text-foreground uppercase ring-1 ring-foreground/10',
        className,
      )}
    >
      {label.slice(0, 1)}
    </span>
  )
}

export function FileChip({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
      {children}
    </code>
  )
}

export function UnsavedHint({ visible }: { visible: boolean }) {
  if (!visible) return null
  return <span className="mr-auto text-sm text-muted-foreground">Unsaved changes</span>
}
