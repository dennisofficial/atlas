import { BRAND_PATHS, type EBrand } from '#brand'
import { cn } from 'cn'

export { EBrand } from '#brand'

export function BrandMark({
  brand,
  size = 'default',
  className,
}: {
  brand: EBrand
  size?: 'default' | 'sm'
  className?: string
}) {
  const { title, d, fill } = BRAND_PATHS[brand]
  return (
    <span
      data-size={size}
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted text-foreground',
        size === 'sm' && 'size-5 border-0 bg-transparent',
        className,
      )}
    >
      <svg
        viewBox="0 0 24 24"
        className={size === 'sm' ? 'size-3.5' : 'size-4'}
        fill={fill ?? 'currentColor'}
        fillRule="evenodd"
        role="img"
      >
        <title>{title}</title>
        <path d={d} />
      </svg>
    </span>
  )
}
