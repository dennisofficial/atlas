import { FileKeyIcon } from 'lucide-react'

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@dltech/atlas-ui/components/table'

import { SettingsSection } from '../settings/settings-layout'
import { PROJECT_FILE_MOUNTS } from './fixtures/project-settings'

const DESCRIPTION =
  'Atlas writes these files into every sandbox of this project when the sandbox starts. A change you make here reaches the next sandbox that starts. Changes a tool makes to a file during a session are lost on the next start.'

export function FilesPage() {
  return (
    <SettingsSection title="Files" description={DESCRIPTION} count={PROJECT_FILE_MOUNTS.length}>
      <Table variant="framed" className="min-w-xl table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[52%]">Path</TableHead>
            <TableHead className="w-[16%]">Mode</TableHead>
            <TableHead className="w-[32%]">Updated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {PROJECT_FILE_MOUNTS.map((mount) => (
            <TableRow key={mount.path}>
              <TableCell className="truncate font-mono text-xs font-medium">
                <FileKeyIcon className="mr-2 inline size-3.5 text-muted-foreground" />
                {mount.path}
              </TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {mount.mode}
              </TableCell>
              <TableCell className="text-muted-foreground">{mount.updated}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </SettingsSection>
  )
}
