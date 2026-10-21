import type { ReactNode } from 'react'

export function ReadOnlyArea({ canEdit, children }: { canEdit: boolean; children: ReactNode }) {
  if (canEdit) return <>{children}</>
  return (
    <div inert className="opacity-70">
      {children}
    </div>
  )
}
