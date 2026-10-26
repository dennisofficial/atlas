'use client'

import { Button } from './ui/button'
import { CheckIcon, CopyIcon, ExternalLinkIcon, MoonIcon, SunIcon } from 'lucide-react'
import { useState } from 'react'

import { ETheme } from './bridge-messages'
import type { Viewport } from './fit-viewport'
import { ViewportMenu } from './viewport-menu'

const COPIED_MS = 1500

export function TopStrip({
  currentPath,
  theme,
  viewport,
  summary,
  onThemeChange,
  onViewportChange,
}: {
  currentPath: string
  theme: ETheme
  viewport: Viewport
  summary: string
  onThemeChange: (theme: ETheme) => void
  onViewportChange: (viewport: Viewport) => void
}) {
  const [copied, setCopied] = useState(false)
  const handleCopy = async () => {
    await navigator.clipboard.writeText(`${window.location.origin}${currentPath}`)
    setCopied(true)
    setTimeout(() => setCopied(false), COPIED_MS)
  }
  const isDark = theme === ETheme.Dark
  const handleTheme = () => onThemeChange(isDark ? ETheme.Light : ETheme.Dark)
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
      <code
        data-testid="frame-url"
        className="min-w-0 flex-1 truncate rounded-md bg-muted px-2.5 py-1 proto-mono text-xs"
      >
        {currentPath}
      </code>
      <Button variant="ghost" size="icon-sm" aria-label="Copy URL" onClick={handleCopy}>
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Open in new tab"
        render={<a href={currentPath} target="_blank" rel="noreferrer" />}
        nativeButton={false}
      >
        <ExternalLinkIcon />
      </Button>
      <ViewportMenu viewport={viewport} summary={summary} onChange={onViewportChange} />
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
        onClick={handleTheme}
      >
        {isDark ? <SunIcon /> : <MoonIcon />}
      </Button>
    </header>
  )
}
