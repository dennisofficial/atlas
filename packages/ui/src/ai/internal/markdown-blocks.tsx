'use client'

import type { ComponentProps, ComponentType } from 'react'
import { cn } from 'cn'
import {
  InfoIcon,
  LightbulbIcon,
  MessageSquareWarningIcon,
  OctagonAlertIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import type { ExtraProps } from 'streamdown'

import { Alert, AlertDescription, AlertTitle } from '#components/alert'
import { Checkbox } from '#components/checkbox'
import { EMarkdownAlert, isMarkdownAlert } from './markdown-alerts'

const TASK_LIST = 'contains-task-list'
const TASK_ITEM = 'task-list-item'

const ALERTS: Record<
  EMarkdownAlert,
  { title: string; icon: ComponentType<{ className?: string }>; tone: string }
> = {
  [EMarkdownAlert.Note]: { title: 'Note', icon: InfoIcon, tone: 'text-link' },
  [EMarkdownAlert.Tip]: { title: 'Tip', icon: LightbulbIcon, tone: 'text-success' },
  [EMarkdownAlert.Important]: {
    title: 'Important',
    icon: MessageSquareWarningIcon,
    tone: 'text-primary',
  },
  [EMarkdownAlert.Warning]: { title: 'Warning', icon: TriangleAlertIcon, tone: 'text-warning' },
  [EMarkdownAlert.Caution]: { title: 'Caution', icon: OctagonAlertIcon, tone: 'text-destructive' },
}

const hasClass = ({ className, name }: { className: string | undefined; name: string }) =>
  className?.split(/\s+/).includes(name) ?? false

export function MarkdownUnorderedList({
  node: _node,
  className,
  ...props
}: ComponentProps<'ul'> & ExtraProps) {
  const tasks = hasClass({ className, name: TASK_LIST })
  return (
    <ul
      data-streamdown="unordered-list"
      className={cn(
        tasks ? 'list-none' : 'list-outside list-disc pl-5 marker:text-muted-foreground',
        'flex flex-col gap-1 [li>&]:mt-1',
        className,
      )}
      {...props}
    />
  )
}

export function MarkdownOrderedList({
  node: _node,
  className,
  ...props
}: ComponentProps<'ol'> & ExtraProps) {
  return (
    <ol
      data-streamdown="ordered-list"
      className={cn(
        'flex list-outside list-decimal flex-col gap-1 pl-5 marker:text-muted-foreground marker:tabular-nums [li>&]:mt-1',
        className,
      )}
      {...props}
    />
  )
}

export function MarkdownListItem({
  node: _node,
  className,
  ...props
}: ComponentProps<'li'> & ExtraProps) {
  const task = hasClass({ className, name: TASK_ITEM })
  return (
    <li
      data-streamdown="list-item"
      className={cn(
        'pl-1 [&>*+*]:mt-2 [&>p]:my-0',
        task && 'flex items-start gap-2 pl-0 [&>*+*]:mt-0',
        className,
      )}
      {...props}
    />
  )
}

export function MarkdownInput({
  node: _node,
  type,
  checked,
  ...props
}: ComponentProps<'input'> & ExtraProps) {
  if (type !== 'checkbox') return <input type={type} checked={checked} {...props} />

  return (
    <Checkbox
      checked={checked === true}
      readOnly
      aria-label={checked ? 'Done' : 'Not done'}
      className="mt-0.5"
    />
  )
}

export function MarkdownBlockquote({
  node: _node,
  className,
  children,
  ...props
}: ComponentProps<'blockquote'> & ExtraProps & { 'data-alert'?: string }) {
  const { 'data-alert': kind, ...rest } = props
  if (!isMarkdownAlert(kind)) {
    return (
      <blockquote
        data-streamdown="blockquote"
        className={cn('border-l-2 pl-4 text-muted-foreground', className)}
        {...rest}
      >
        {children}
      </blockquote>
    )
  }

  const alert = ALERTS[kind]
  const Icon = alert.icon
  return (
    <Alert role="note" data-alert={kind} className={cn('my-4', alert.tone)}>
      <Icon />
      <AlertTitle>{alert.title}</AlertTitle>
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  )
}
