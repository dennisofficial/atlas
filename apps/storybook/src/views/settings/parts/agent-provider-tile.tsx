import { cn } from '@dltech/atlas-ui/lib/utils'

export function ProviderTile({ letter, className }: { letter: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-8 items-center justify-center rounded-md border bg-muted font-mono text-sm font-semibold text-foreground',
        className,
      )}
    >
      {letter}
    </span>
  )
}
