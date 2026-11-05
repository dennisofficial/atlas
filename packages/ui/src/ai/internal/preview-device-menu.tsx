import { MonitorSmartphoneIcon, RotateCwSquareIcon } from 'lucide-react'

import { Button } from '#components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#components/dropdown-menu'
import {
  EViewportKind,
  FULL_PARAM,
  formatViewportParam,
  formatZoom,
  parseViewportParam,
  presetParam,
  rotateViewport,
  VIEWPORT_PRESETS,
  type Viewport,
  type ViewportFit,
} from './viewport'

export function deviceSummaryOf({
  viewport,
  fit,
}: {
  viewport: Viewport
  fit: ViewportFit
}): string {
  if (viewport.kind === EViewportKind.Full) return ''
  const size = `${viewport.width}×${viewport.height}`
  if (fit.scale >= 1) return size
  return `${size} · ${formatZoom(fit.scale)}`
}

export interface PreviewDeviceMenuProps {
  viewport: Viewport
  fit: ViewportFit
  onChange: (viewport: Viewport) => void
}

export function PreviewDeviceMenu({ viewport, fit, onChange }: PreviewDeviceMenuProps) {
  const summary = deviceSummaryOf({ viewport, fit })
  const handleValueChange = (value: string) => onChange(parseViewportParam(value))
  const handleRotate = () => onChange(rotateViewport(viewport))
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size={summary ? 'sm' : 'icon-sm'} aria-label="Device size">
            <MonitorSmartphoneIcon data-icon={summary ? 'inline-start' : undefined} />
            {summary ? <span className="font-mono tabular-nums">{summary}</span> : null}
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuRadioGroup
          value={formatViewportParam(viewport)}
          onValueChange={handleValueChange}
        >
          <DropdownMenuRadioItem value={FULL_PARAM} closeOnClick>
            Fit panel
          </DropdownMenuRadioItem>
          {VIEWPORT_PRESETS.map((preset) => (
            <DropdownMenuRadioItem key={preset.label} value={presetParam(preset)} closeOnClick>
              <span className="flex-1">{preset.label}</span>
              <span className="font-mono text-xs text-muted-foreground tabular-nums">
                {preset.width}×{preset.height}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={viewport.kind === EViewportKind.Full} onClick={handleRotate}>
          <RotateCwSquareIcon />
          Rotate
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
