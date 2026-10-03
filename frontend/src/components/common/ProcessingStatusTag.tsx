import type { ProcessingStatus } from '@/utils/fumigation'

const STYLES: Record<ProcessingStatus, string> = {
  未处理: 'bg-slate-100 text-slate-700 border-slate-300',
  待熏蒸: 'bg-violet-50 text-violet-700 border-violet-300',
  熏蒸中: 'bg-amber-50 text-amber-700 border-amber-300',
  已回迁: 'bg-emerald-50 text-emerald-700 border-emerald-300'
}

const DOTS: Record<ProcessingStatus, string> = {
  未处理: 'bg-slate-400',
  待熏蒸: 'bg-violet-500',
  熏蒸中: 'bg-amber-500',
  已回迁: 'bg-emerald-500'
}

export interface ProcessingStatusTagProps {
  status: ProcessingStatus
  withDot?: boolean
  className?: string
}

/** 标本处理状态标签：未处理 / 待熏蒸 / 熏蒸中 / 已回迁 各自配色 */
export default function ProcessingStatusTag({
  status,
  withDot = true,
  className = ''
}: ProcessingStatusTagProps): JSX.Element {
  return (
    <span
      data-testid="processing-status-tag"
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs leading-5 ${STYLES[status]} ${className}`}
    >
      {withDot ? <i className={`h-1.5 w-1.5 rounded-full ${DOTS[status]}`} /> : null}
      {status}
    </span>
  )
}
