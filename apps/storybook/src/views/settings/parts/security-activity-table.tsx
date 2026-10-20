import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dltech/atlas-ui/components/table";

import { SIGN_IN_ACTIVITY } from "../../../fixtures/settings-security";

const HEAD = "h-9 px-4 text-xs font-normal text-muted-foreground";

export function ActivityTable() {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className={HEAD}>Event</TableHead>
          <TableHead className={HEAD}>Device</TableHead>
          <TableHead className={HEAD}>IP</TableHead>
          <TableHead className={`${HEAD} text-right`}>Time</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {SIGN_IN_ACTIVITY.map((entry) => (
          <TableRow key={entry.id}>
            <TableCell className="px-4 py-2.5">{entry.event}</TableCell>
            <TableCell className="px-4 py-2.5 font-mono text-xs">{entry.device}</TableCell>
            <TableCell className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{entry.ip}</TableCell>
            <TableCell className="px-4 py-2.5 text-right font-mono text-xs text-muted-foreground">
              {entry.time}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
