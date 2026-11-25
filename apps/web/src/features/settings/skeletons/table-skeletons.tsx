import { Skeleton } from '@dltech/atlas-ui/components/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@dltech/atlas-ui/components/table'

import { Line } from './primitives'

const ROW_KEYS = ['a', 'b', 'c']

export function EnvSecretsSkeleton() {
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          Values
          <Skeleton className="h-3 w-3" />
        </h3>
        <div className="flex items-center gap-2">
          <Skeleton className="h-7 w-20 rounded-lg" />
          <Skeleton className="h-7 w-24 rounded-lg" />
        </div>
      </div>
      <Table variant="framed" className="min-w-xl table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[36%]">Name</TableHead>
            <TableHead className="w-[36%]">Value</TableHead>
            <TableHead className="w-[20%]">Updated</TableHead>
            <TableHead className="w-12">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ROW_KEYS.map((key) => (
            <TableRow key={key}>
              <TableCell>
                <Skeleton className="h-4 w-32" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-28" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-16" />
              </TableCell>
              <TableCell className="text-right">
                <Skeleton className="ml-auto size-7 rounded-lg" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  )
}
