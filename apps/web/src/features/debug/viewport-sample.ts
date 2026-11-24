export type TViewportSample = {
  window: { width: number; height: number }
  documentHeight: number
  visualViewport: { height: number; offsetTop: number } | null
  screen: { width: number; height: number }
  units: { svh: number; lvh: number; dvh: number; vh: number; fixedInset: number }
  insets: { top: number; right: number; bottom: number; left: number }
  standalone: boolean
}

export type TProbeRow = { label: string; value: string }

const sizeOf = ({ width, height }: { width: number; height: number }) => `${width} × ${height}`

export const probeRowsOf = (sample: TViewportSample): TProbeRow[] => [
  { label: 'standalone', value: sample.standalone ? 'yes' : 'no' },
  { label: 'window', value: sizeOf(sample.window) },
  { label: 'document', value: String(sample.documentHeight) },
  {
    label: 'visualViewport',
    value:
      sample.visualViewport === null
        ? 'none'
        : `${sample.visualViewport.height} (top ${sample.visualViewport.offsetTop})`,
  },
  { label: 'screen', value: sizeOf(sample.screen) },
  { label: '100svh', value: String(sample.units.svh) },
  { label: '100lvh', value: String(sample.units.lvh) },
  { label: '100dvh', value: String(sample.units.dvh) },
  { label: '100vh', value: String(sample.units.vh) },
  { label: 'fixed inset 0', value: String(sample.units.fixedInset) },
  {
    label: 'insets t r b l',
    value: [sample.insets.top, sample.insets.right, sample.insets.bottom, sample.insets.left].join(
      ' ',
    ),
  },
  { label: 'svh + top inset', value: String(sample.units.svh + sample.insets.top) },
]
