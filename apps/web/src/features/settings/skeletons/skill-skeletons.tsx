import { Skeleton } from '@dltech/atlas-ui/components/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@dltech/atlas-ui/components/table'

const ROW_KEYS = ['a', 'b', 'c']

export function SkillsTableSkeleton() {
  return (
    <Table variant="framed" className="table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">
            <span className="sr-only">Select</span>
          </TableHead>
          <TableHead>Skill</TableHead>
          <TableHead className="w-28">Usage</TableHead>
          <TableHead className="w-16">Files</TableHead>
          <TableHead className="w-20">Size</TableHead>
          <TableHead className="w-24">Updated</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {ROW_KEYS.map((key) => (
          <TableRow key={key}>
            <TableCell>
              <Skeleton className="size-4 rounded-[4px]" />
            </TableCell>
            <TableCell>
              <div className="flex flex-col gap-1">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-56" />
              </div>
            </TableCell>
            <TableCell>
              <Skeleton className="h-4 w-16" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-4 w-6" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-4 w-12" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-4 w-14" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function SkillDetailSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-6">
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-5 w-16" />
        <Skeleton className="h-5 w-48" />
      </div>
      <Skeleton className="h-4 w-96 max-w-full" />
      <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)] gap-4">
        <Skeleton className="h-full min-h-64 rounded-lg" />
        <Skeleton className="h-full min-h-64 rounded-lg" />
      </div>
    </div>
  )
}
