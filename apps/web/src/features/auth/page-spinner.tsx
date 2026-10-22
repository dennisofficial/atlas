import { Spinner } from '@dltech/atlas-ui/components/spinner'

export function PageSpinner({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"
    >
      <Spinner />
      <span>{label}</span>
    </div>
  )
}
