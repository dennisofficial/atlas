import { describe, expect, it } from 'bun:test'
import { Children, isValidElement, type ReactNode } from 'react'

import { ComboboxContent, ComboboxItem, ComboboxList } from '../combobox'
import { Command, CommandItem } from '../command'
import { DialogContent } from '../dialog'
import {
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioItem,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '../dropdown-menu'
import { PopoverContent } from '../popover'
import { SelectContent, SelectItem } from '../select'

type SurfaceProps = { className?: string; children?: ReactNode }

function classesIn(node: ReactNode): string[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<SurfaceProps>(child)) return []
    return [child.props.className ?? '', ...classesIn(child.props.children)]
  })
}

const surfaces = [
  ['popover', PopoverContent({})],
  ['dropdown menu', DropdownMenuContent({})],
  ['dropdown submenu', DropdownMenuSubContent({})],
  ['dialog', DialogContent({})],
  ['select', SelectContent({})],
  ['combobox', ComboboxContent({})],
] as const

const items = [
  ['command', CommandItem({})],
  ['dropdown menu', DropdownMenuItem({})],
  ['dropdown submenu trigger', DropdownMenuSubTrigger({})],
  ['dropdown checkbox', DropdownMenuCheckboxItem({})],
  ['dropdown radio', DropdownMenuRadioItem({ value: 'one' })],
  ['select', SelectItem({ value: 'one' })],
  ['combobox', ComboboxItem({})],
] as const

describe('floating cards', () => {
  it.each(surfaces)('%s shares rounded corners, elevation and a soft ring', (_, surface) => {
    const classes = classesIn(surface).join(' ').split(' ')
    expect(classes).toContain('rounded-xl')
    expect(classes).toContain('shadow-lg')
    expect(classes).toContain('ring-1')
    expect(classes).toContain('ring-border')
    expect(classes).not.toContain('shadow-md')
    expect(classes).not.toContain('border')
  })

  it.each(items)('%s uses rounded hover pills', (_, item) => {
    expect(item.props.className.split(' ')).toContain('rounded-lg')
  })

  it('preserves the menu inset around the rounded items', () => {
    for (const surface of [
      DropdownMenuContent({}),
      SelectContent({}),
      ComboboxList({}),
      Command({}),
    ]) {
      expect(classesIn(surface).join(' ').split(' ')).toContain('p-1')
    }
  })
})
