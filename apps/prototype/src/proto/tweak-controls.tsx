'use client'

import { Label } from './ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Slider } from './ui/slider'
import { Switch } from './ui/switch'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'
import { useEffect, useState } from 'react'

import type { ControlValue } from './bridge-messages'
import { ESelectLayout, humanizeOption, selectLayout } from './tweak-options'
import type { Control } from './use-prototype'

interface ControlProps<T extends Control> {
  id: string
  control: T
  value: ControlValue | undefined
  onChange: (value: ControlValue) => void
}

function SelectControl({
  id,
  control,
  value,
  onChange,
}: ControlProps<Extract<Control, { type: 'select' }>>) {
  const current = typeof value === 'string' ? value : control.default
  if (selectLayout({ options: control.options }) === ESelectLayout.Segmented) {
    const handleValueChange = (next: string[]) => {
      const picked = next[0]
      if (picked !== undefined) onChange(picked)
    }
    return (
      <ToggleGroup
        aria-labelledby={`${id}-label`}
        value={[current]}
        onValueChange={handleValueChange}
        variant="outline"
        size="sm"
        spacing={0}
      >
        {control.options.map((option) => (
          <ToggleGroupItem key={option} value={option}>
            {humanizeOption(option)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    )
  }
  const handleValueChange = (next: string | null) => {
    if (next !== null) onChange(next)
  }
  const items = control.options.map((option) => ({ value: option, label: humanizeOption(option) }))
  return (
    <Select items={items} value={current} onValueChange={handleValueChange}>
      <SelectTrigger id={id} aria-labelledby={`${id}-label`} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        {control.options.map((option) => (
          <SelectItem key={option} value={option}>
            {humanizeOption(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function BooleanControl({
  id,
  control,
  value,
  onChange,
}: ControlProps<Extract<Control, { type: 'boolean' }>>) {
  const checked = typeof value === 'boolean' ? value : control.default
  return (
    <Switch id={id} aria-labelledby={`${id}-label`} checked={checked} onCheckedChange={onChange} />
  )
}

function RangeControl({
  id,
  control,
  value,
  onChange,
}: ControlProps<Extract<Control, { type: 'range' }>>) {
  const committed = typeof value === 'number' ? value : control.default
  const [draft, setDraft] = useState(committed)
  useEffect(() => setDraft(committed), [committed])
  const handleValueChange = (next: number | readonly number[]) => {
    const picked = typeof next === 'number' ? next : next[0]
    if (picked === undefined) return
    setDraft(picked)
    onChange(picked)
  }
  return (
    <div className="flex items-center gap-3">
      <Slider
        id={id}
        aria-labelledby={`${id}-label`}
        min={control.min}
        max={control.max}
        step={control.step ?? 1}
        value={[draft]}
        onValueChange={handleValueChange}
      />
      <output className="w-8 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
        {draft}
      </output>
    </div>
  )
}

function ControlInput(props: ControlProps<Control>) {
  const { control } = props
  if (control.type === 'select') return <SelectControl {...props} control={control} />
  if (control.type === 'boolean') return <BooleanControl {...props} control={control} />
  return <RangeControl {...props} control={control} />
}

export function TweakField({
  name,
  control,
  value,
  onChange,
}: {
  name: string
  control: Control
  value: ControlValue | undefined
  onChange: (value: ControlValue) => void
}) {
  const id = `tweak-${name}`
  const isInline = control.type === 'boolean'
  return (
    <div
      data-testid={`tweak-${name}`}
      className={isInline ? 'flex items-center justify-between gap-3' : 'flex flex-col gap-2'}
    >
      <Label id={`${id}-label`} htmlFor={id}>
        {control.label}
      </Label>
      <ControlInput id={id} control={control} value={value} onChange={onChange} />
    </div>
  )
}
