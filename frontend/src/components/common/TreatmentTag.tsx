import type { TreatmentItemStatus, TreatmentOrderStatus } from '@/types'

const ITEM_STYLES: Record<TreatmentItemStatus, string> = {
  已出柜: 'bg-indigo-50 text-indigo-700 border-indigo-300',
  回迁受阻: 'bg-rose-50 text-rose-700 border-rose-300',
  已回迁: 'bg-emerald-50 text-emerald-700 border-emerald-300'
}

const ORDER_STYLES: Record<TreatmentOrderStatus, string> = {
  草稿: 'bg-slate-100 text-slate-600 border-slate-300',
  熏蒸中: 'bg-indigo-50 text-indigo-700 border-indigo-300',
  已完成: 'bg-emerald-50 text-emerald-700 border-emerald-300'
}

export interface TreatmentTagProps {
  status: TreatmentItemStatus | TreatmentOrderStatus
  className?: string
}

/** 熏蒸处理状态标签：处理单 / 单份明细共用配色 */
export default function TreatmentTag({ status, className = '' }: TreatmentTagProps): JSX.Element {
  const tone =
    status in ITEM_STYLES
      ? ITEM_STYLES[status as TreatmentItemStatus]
      : ORDER_STYLES[status as TreatmentOrderStatus]
  return (
    <span
      data-testid="treatment-tag"
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs leading-5 ${tone} ${className}`}
    >
      {status}
    </span>
  )
}
