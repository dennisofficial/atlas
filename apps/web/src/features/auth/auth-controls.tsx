import { AlertCircle } from 'lucide-react'
import Link from 'next/link'
import type { ComponentProps, ReactNode } from 'react'

import { Alert, AlertDescription } from '@dltech/atlas-ui/components/alert'
import { Button } from '@dltech/atlas-ui/components/button'
import { Separator } from '@dltech/atlas-ui/components/separator'
import { Spinner } from '@dltech/atlas-ui/components/spinner'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { GoogleLogo } from './google-logo'

export const CONTROL_CLASS = 'h-10'

const LINK_CLASS =
  'rounded-sm font-medium text-link underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50'

export function AuthLink({ className, ...props }: ComponentProps<typeof Link>) {
  return <Link className={cn(LINK_CLASS, className)} {...props} />
}

export function AuthLinkButton({ className, ...props }: ComponentProps<'button'>) {
  return <button type="button" className={cn(LINK_CLASS, className)} {...props} />
}

export function LinkButton({
  href,
  variant,
  children,
}: {
  href: string
  variant?: ComponentProps<typeof Button>['variant']
  children: ReactNode
}) {
  return (
    <Button
      variant={variant}
      className={cn(CONTROL_CLASS, 'w-full')}
      nativeButton={false}
      render={<Link href={href} />}
    >
      {children}
    </Button>
  )
}

export function GoogleButton({
  label,
  busy,
  disabled,
  onPress,
}: {
  label: string
  busy?: boolean
  disabled?: boolean
  onPress: () => void
}) {
  return (
    <Button
      type="button"
      variant="outline"
      className={cn(CONTROL_CLASS, 'w-full gap-2')}
      disabled={disabled || busy}
      onClick={onPress}
    >
      {busy ? <Spinner /> : <GoogleLogo className="size-4" />}
      {label}
    </Button>
  )
}

export function OrDivider() {
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground" role="separator">
      <Separator className="flex-1" />
      or
      <Separator className="flex-1" />
    </div>
  )
}

export function FormError({ children }: { children: ReactNode }) {
  return (
    <Alert variant="destructive">
      <AlertCircle />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  )
}

export function SubmitButton({
  busy,
  disabled,
  children,
}: {
  busy?: boolean
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <Button type="submit" className={cn(CONTROL_CLASS, 'w-full')} disabled={busy || disabled}>
      {busy && <Spinner data-icon="inline-start" />}
      {children}
    </Button>
  )
}

export function AuthFooterText({ children }: { children: ReactNode }) {
  return <p className="text-center text-sm text-muted-foreground">{children}</p>
}
