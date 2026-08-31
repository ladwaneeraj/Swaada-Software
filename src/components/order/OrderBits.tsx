import { Badge, VegMark } from '@/components/ui'
import { ITEM_STATUS_META } from '@/lib/statusMeta'
import { cn, formatINR } from '@/lib/utils'
import type { Order, OrderItem } from '@/types'

/** Shared order rendering used by Orders, Dashboard, History and Tables. */

export function OrderItemLine({
  item,
  showStatus = true,
  muted = false,
}: {
  item: OrderItem
  showStatus?: boolean
  muted?: boolean
}) {
  const meta = ITEM_STATUS_META[item.status]
  return (
    <div className={cn('flex items-start justify-between gap-3 py-2', muted && 'opacity-50')}>
      <div className="flex min-w-0 items-start gap-2.5">
        <span className="mt-0.5 w-7 shrink-0 text-sm font-bold text-ink-500">{item.quantity}×</span>
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <VegMark isVeg={item.isVegetarian} className="size-3.5" />
            <span className={cn('truncate', item.status === 'cancelled' && 'line-through')}>{item.name}</span>
          </p>
          {item.modifiers.length > 0 && (
            <p className="mt-0.5 text-xs text-ink-500">
              {item.modifiers.map((m) => m.optionName).join(' · ')}
            </p>
          )}
          {item.specialInstructions && (
            <p className="mt-0.5 text-xs italic text-accent-600">“{item.specialInstructions}”</p>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {showStatus && (
          <Badge tone={meta.tone} dot>
            {meta.label}
          </Badge>
        )}
        <span className="w-16 text-right text-sm font-semibold tabular-nums">
          {formatINR(item.unitPrice * item.quantity)}
        </span>
      </div>
    </div>
  )
}

export function OrderTotals({ order, compact = false }: { order: Order; compact?: boolean }) {
  return (
    <div className={cn('space-y-1 text-sm', compact && 'text-xs')}>
      <div className="flex justify-between text-ink-500">
        <span>Subtotal</span>
        <span className="tabular-nums">{formatINR(order.subtotal)}</span>
      </div>
      <div className="flex justify-between text-ink-500">
        <span>
          {order.taxLabel} ({order.taxRatePercent}%)
        </span>
        <span className="tabular-nums">{formatINR(order.taxAmount)}</span>
      </div>
      <div className="flex justify-between text-base font-bold">
        <span>Total</span>
        <span className="tabular-nums">{formatINR(order.total)}</span>
      </div>
    </div>
  )
}
