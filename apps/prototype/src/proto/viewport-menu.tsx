'use client'

import { Button } from '@dltech/atlas-ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@dltech/atlas-ui/components/dropdown-menu'
import { Input } from '@dltech/atlas-ui/components/input'
import { MonitorIcon, RotateCwIcon } from 'lucide-react'
import { useEffect, useState } from 'react'

import { EViewportKind, type Viewport } from './fit-viewport'
import {
  clampDimension,
  formatViewportParam,
  FULL_PARAM,
  parseViewportParam,
  presetParam,
  rotateViewport,
  VIEWPORT_PRESETS,
} from './viewport-param'

function CustomSize({
  viewport,
  onChange,
}: {
  viewport: Viewport
  onChange: (v: Viewport) => void
}) {
  const isFixed = viewport.kind === EViewportKind.Fixed
  const [width, setWidth] = useState(isFixed ? String(viewport.width) : '')
  const [height, setHeight] = useState(isFixed ? String(viewport.height) : '')
  useEffect(() => {
    if (viewport.kind !== EViewportKind.Fixed) return
    setWidth(String(viewport.width))
    setHeight(String(viewport.height))
  }, [viewport])
  const commit = ({ w, h }: { w: string; h: string }) => {
    const nextWidth = Number(w)
    const nextHeight = Number(h)
    if (!Number.isFinite(nextWidth) || !Number.isFinite(nextHeight) || !w || !h) return
    onChange({
      kind: EViewportKind.Fixed,
      width: clampDimension(nextWidth),
      height: clampDimension(nextHeight),
    })
  }
  const handleBlur = () => commit({ w: width, h: height })
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') commit({ w: width, h: height })
  }
  return (
    <div className="flex items-center gap-1.5">
      <Input
        aria-label="Custom width"
        inputMode="numeric"
        value={width}
        placeholder="W"
        onChange={(event) => setWidth(event.target.value.replace(/\D/g, ''))}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className="h-7 w-16 text-center tabular-nums"
      />
      <span className="text-xs text-muted-foreground">×</span>
      <Input
        aria-label="Custom height"
        inputMode="numeric"
        value={height}
        placeholder="H"
        onChange={(event) => setHeight(event.target.value.replace(/\D/g, ''))}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className="h-7 w-16 text-center tabular-nums"
      />
    </div>
  )
}

export function ViewportMenu({
  viewport,
  summary,
  onChange,
}: {
  viewport: Viewport
  summary: string
  onChange: (viewport: Viewport) => void
}) {
  const handleValueChange = (next: string) => onChange(parseViewportParam(next))
  const handleRotate = () => onChange(rotateViewport(viewport))
  const isFull = viewport.kind === EViewportKind.Full
  return (
    <div className="flex items-center gap-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" size="sm" aria-label="Viewport size">
              <MonitorIcon data-icon="inline-start" />
              <span className="tabular-nums">{summary}</span>
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuRadioGroup
            value={formatViewportParam(viewport)}
            onValueChange={handleValueChange}
          >
            <DropdownMenuRadioItem value={FULL_PARAM} closeOnClick>
              Full
            </DropdownMenuRadioItem>
            {VIEWPORT_PRESETS.map((preset) => (
              <DropdownMenuRadioItem key={preset.label} value={presetParam(preset)} closeOnClick>
                <span className="flex-1">{preset.label}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {preset.width}×{preset.height}
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <div className="p-1.5">
            <CustomSize viewport={viewport} onChange={onChange} />
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Rotate viewport"
        disabled={isFull}
        onClick={handleRotate}
      >
        <RotateCwIcon />
      </Button>
    </div>
  )
}
