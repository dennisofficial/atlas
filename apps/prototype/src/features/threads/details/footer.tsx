import { FOOTER_PATHS } from './details-fixtures'

export function DetailsFooter() {
  return (
    <footer className="flex shrink-0 flex-col gap-0.5 border-t px-3 py-2 font-mono text-xs text-muted-foreground">
      {FOOTER_PATHS.map((path) => (
        <p key={path} className="truncate" title={path}>
          {path}
        </p>
      ))}
    </footer>
  )
}
