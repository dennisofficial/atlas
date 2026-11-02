import { Skeleton } from '@dltech/atlas-ui/components/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@dltech/atlas-ui/components/table'

import { SettingsCard } from '../settings-layout'
import { ERowControl, Line, SettingsRowSkeleton } from './primitives'

const ROW_KEYS = ['a', 'b', 'c']

export function EnvSecretsSkeleton() {
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">Values</h3>
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

export function NotifyMatrixSkeleton() {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="text-xs font-normal text-muted-foreground">Event</TableHead>
          {['In-app', 'Push', 'Email'].map((label) => (
            <TableHead
              key={label}
              className="w-20 text-center text-xs font-normal text-muted-foreground"
            >
              {label}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {['a', 'b', 'c', 'd', 'e', 'f'].map((key) => (
          <TableRow key={key}>
            <TableCell>
              <div className="flex flex-col gap-0.5">
                <Line width="w-40" />
                <Skeleton className="my-px h-3.5 w-56" />
              </div>
            </TableCell>
            {[0, 1, 2].map((column) => (
              <TableCell key={column}>
                <div className="flex justify-center">
                  <Skeleton className="size-4 rounded-[4px]" />
                </div>
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function SandboxTableSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <Table variant="framed" className="min-w-xl">
      <TableHeader>
        <TableRow>
          <TableHead className="text-xs text-muted-foreground">Thread</TableHead>
          <TableHead className="text-xs text-muted-foreground">Status</TableHead>
          <TableHead className="text-right text-xs text-muted-foreground">Last 24h</TableHead>
          <TableHead className="w-24">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: rows }, (_, index) => (
          <TableRow key={index}>
            <TableCell className="max-w-64">
              <div className="flex flex-col gap-0.5">
                <Line width="w-40" />
                <Skeleton className="my-px h-3.5 w-28" />
              </div>
            </TableCell>
            <TableCell>
              <Skeleton className="h-4 w-32" />
            </TableCell>
            <TableCell>
              <Skeleton className="ml-auto h-3.5 w-20" />
            </TableCell>
            <TableCell>
              <Skeleton className="ml-auto h-6 w-16 rounded-lg" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function VercelCardSkeleton() {
  return (
    <SettingsCard
      footer={
        <>
          <Skeleton className="mr-auto h-7 w-16 rounded-lg" />
          <Skeleton className="h-7 w-14 rounded-lg" />
        </>
      }
    >
      <SettingsRowSkeleton media custom={<Skeleton className="h-4 w-24" />} lines={2} />
      <SettingsRowSkeleton control={ERowControl.Input} lines={1} />
      <SettingsRowSkeleton control={ERowControl.Input} lines={1} />
      <SettingsRowSkeleton
        lines={2}
        custom={
          <>
            <Skeleton className="h-8 w-72 max-w-full rounded-lg" />
            <Skeleton className="h-7 w-28 rounded-lg" />
          </>
        }
      />
    </SettingsCard>
  )
}
