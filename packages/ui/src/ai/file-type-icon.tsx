'use client'

import { cn } from '#lib/utils'
import { artOf, EIconPart, FILE_ICON_ART, fileIconOf } from '../file-icons'
import { useColoredFileIcons } from './internal/file-icons-context'

export { FileIconsProvider } from './internal/file-icons-context'

export function FileTypeIcon({
  name,
  folder = false,
  open = false,
  className,
}: {
  name: string
  folder?: boolean
  open?: boolean
  className?: string
}) {
  const colored = useColoredFileIcons()
  const icon = fileIconOf({ name, folder })
  return (
    <svg aria-hidden viewBox={FILE_ICON_ART[icon].viewBox} className={cn('shrink-0', className)}>
      {artOf({ icon, open }).map((path, index) => (
        <path
          key={index}
          d={path.d}
          fill={colored ? (path.fill ?? 'currentColor') : 'currentColor'}
          fillOpacity={!colored && path.part === EIconPart.Body ? 0.45 : undefined}
          fillRule={path.fillRule}
        />
      ))}
    </svg>
  )
}
