import { MonitorSmartphoneIcon, RotateCwSquareIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@dltech/atlas-ui/components/dropdown-menu'

import { EViewportKind, formatZoom, type Viewport, type ViewportFit } from '@/proto/fit-viewport'
import {
  FULL_PARAM,
  formatViewportParam,
  parseViewportParam,
  presetParam,
  rotateViewport,
  VIEWPORT_PRESETS,
} from '@/proto/viewport-param'

export function deviceSummaryOf(args: {
  viewport: Viewport
  fit: ViewportFit
  native: boolean
}): string {
  const { viewport, fit, native } = args
  if (viewport.kind === EViewportKind.Full) return ''
  const size = `${viewport.width}×${viewport.height}`
  return native || fit.scale >= 1 ? size : `${size} · ${formatZoom(fit.scale)}`
}

export function DeviceMenu(props: {
  viewport: Viewport
  summary: string
  native: boolean
  onChange: (viewport: Viewport) => void
}) {
  const { viewport, summary, native, onChange } = props
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
        {native ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>
                Mac: sizes wider than the panel scroll instead of shrinking
              </DropdownMenuLabel>
            </DropdownMenuGroup>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
