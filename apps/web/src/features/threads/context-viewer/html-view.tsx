'use client'

import { CodeIcon, EyeIcon } from 'lucide-react'

import { ToggleGroup, ToggleGroupItem } from '@dltech/atlas-ui/components/toggle-group'

import { EContextView } from './context-model'

export function HtmlFrame(props: { html: string; title: string }) {
  return (
    <iframe
      title={props.title}
      srcDoc={props.html}
      sandbox="allow-scripts"
      className="size-full border-0 bg-white"
    />
  )
}

export function ContextViewToggle(props: {
  value: EContextView
  onValueChange: (value: EContextView) => void
}) {
  const handleValueChange = (next: string[]) => {
    const picked = next[0]
    if (picked === EContextView.Rendered || picked === EContextView.Source) {
      props.onValueChange(picked)
    }
  }
  return (
    <ToggleGroup
      variant="outline"
      size="sm"
      spacing={0}
      value={[props.value]}
      onValueChange={handleValueChange}
      aria-label="View"
    >
      <ToggleGroupItem value={EContextView.Rendered} aria-label="Rendered">
        <EyeIcon />
        Rendered
      </ToggleGroupItem>
      <ToggleGroupItem value={EContextView.Source} aria-label="Source">
        <CodeIcon />
        Source
      </ToggleGroupItem>
    </ToggleGroup>
  )
}
