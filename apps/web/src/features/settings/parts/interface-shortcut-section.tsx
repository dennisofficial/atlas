import { Kbd, KbdGroup } from '@dltech/atlas-ui/components/kbd'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@dltech/atlas-ui/components/table'

import type { ShortcutSection } from '../fixtures/settings-interface'
import { SettingsCard, SettingsSection } from '../settings-layout'

export function ShortcutSectionCard({ section }: { section: ShortcutSection }) {
  return (
    <SettingsSection title={section.title}>
      <SettingsCard>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-9 px-4 text-xs font-normal text-muted-foreground">
                Action
              </TableHead>
              <TableHead className="h-9 px-4 text-right text-xs font-normal text-muted-foreground">
                Shortcut
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {section.shortcuts.map((shortcut) => (
              <TableRow key={shortcut.action}>
                <TableCell className="px-4 py-2.5">{shortcut.action}</TableCell>
                <TableCell className="px-4 py-2.5">
                  <KbdGroup className="float-right">
                    {shortcut.keys.map((key) => (
                      <Kbd key={key}>{key}</Kbd>
                    ))}
                  </KbdGroup>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SettingsCard>
    </SettingsSection>
  )
}
