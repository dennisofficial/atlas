import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { Alert, AlertDescription } from '@dltech/atlas-ui/components/alert'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { CENTER_TEXT } from './auth-align'

export function AuthHeading({ title, description }: { title: ReactNode; description?: ReactNode }) {
  return (
    <div className={cn('flex flex-col gap-2', CENTER_TEXT)}>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-balance text-foreground">
        {title}
      </h1>
      {description && (
        <p className="text-sm leading-relaxed text-pretty text-muted-foreground">{description}</p>
      )}
    </div>
  )
}

export function AuthBanner({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <Alert>
      <Icon />
      <AlertDescription className="text-foreground">{children}</AlertDescription>
    </Alert>
  )
}
