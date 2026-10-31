export interface RunFailedMarkerProps {
  label: string
}

export function RunFailedMarker({ label }: RunFailedMarkerProps) {
  return (
    <p data-slot="run-failed-marker" className="font-mono text-xs text-destructive">
      ✗ {label}
    </p>
  )
}
