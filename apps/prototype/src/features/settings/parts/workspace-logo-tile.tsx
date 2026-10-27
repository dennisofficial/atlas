export function WorkspaceLogoTile({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className="flex size-12 items-center justify-center rounded-lg bg-primary text-xl font-semibold text-primary-foreground"
    >
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}
