import type { ReactNode } from 'react'

import { Field, FieldGroup } from '@dltech/atlas-ui/components/field'
import { Skeleton } from '@dltech/atlas-ui/components/skeleton'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { CENTER_ROW } from './auth-align'
import { OrDivider } from './auth-controls'

export function AuthHeadingSkeleton({ descriptionLines = 1 }: { descriptionLines?: number }) {
  return (
    <div className="flex flex-col gap-2">
      <div className={cn('flex h-8 items-center', CENTER_ROW)}>
        <Skeleton className="h-6 w-56 max-w-full" />
      </div>
      <div className="flex flex-col">
        {Array.from({ length: descriptionLines }, (_, line) => (
          <div key={line} className={cn('flex h-5.5 items-center', CENTER_ROW)}>
            <Skeleton className={cn('h-3.5', line === descriptionLines - 1 ? 'w-2/3' : 'w-full')} />
          </div>
        ))}
      </div>
    </div>
  )
}

export function AuthFieldSkeleton({
  action = false,
  description = false,
}: {
  action?: boolean
  description?: boolean
}) {
  return (
    <Field>
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-3.5 w-16" />
        {action && (
          <span className="flex h-5 items-center">
            <Skeleton className="h-3.5 w-28" />
          </span>
        )}
      </div>
      <Skeleton className="h-9 w-full rounded-lg" />
      {description && (
        <div className="flex h-5 items-center">
          <Skeleton className="h-3.5 w-40" />
        </div>
      )}
    </Field>
  )
}

export function AuthButtonSkeleton() {
  return <Skeleton className="h-9 w-full rounded-lg" />
}

export function AuthTextLineSkeleton({ width = 'w-48' }: { width?: string }) {
  return (
    <div className="flex h-5 items-center justify-center">
      <Skeleton className={cn('h-3.5', width)} />
    </div>
  )
}

export interface AuthFieldSpec {
  key: string
  action?: boolean
  description?: boolean
}

export function AuthFormSkeleton({
  label,
  descriptionLines = 1,
  google = false,
  fields,
  footer = false,
}: {
  label: string
  descriptionLines?: number
  google?: boolean
  fields: readonly AuthFieldSpec[]
  footer?: boolean
}) {
  const form = (
    <FieldGroup>
      {fields.map(({ key, ...spec }) => (
        <AuthFieldSkeleton key={key} {...spec} />
      ))}
      <AuthButtonSkeleton />
    </FieldGroup>
  )
  const body: ReactNode = google ? (
    <div className="flex flex-col gap-4">
      <AuthButtonSkeleton />
      <OrDivider />
      {form}
    </div>
  ) : (
    form
  )
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-6">
      <AuthHeadingSkeleton descriptionLines={descriptionLines} />
      {body}
      {footer && <AuthTextLineSkeleton />}
    </div>
  )
}

export function SignInSkeleton() {
  return (
    <AuthFormSkeleton
      label="Loading sign-in"
      google
      footer
      fields={[{ key: 'email' }, { key: 'password', action: true }]}
    />
  )
}

export function SignUpSkeleton() {
  return (
    <AuthFormSkeleton
      label="Loading sign-up"
      google
      footer
      fields={[{ key: 'name' }, { key: 'email' }, { key: 'password', description: true }]}
    />
  )
}

export function ForgotPasswordSkeleton() {
  return (
    <AuthFormSkeleton
      label="Loading password reset"
      descriptionLines={2}
      footer
      fields={[{ key: 'email' }]}
    />
  )
}

export function ResetPasswordSkeleton() {
  return (
    <AuthFormSkeleton
      label="Loading password reset"
      fields={[{ key: 'password', description: true }, { key: 'confirm' }]}
    />
  )
}
