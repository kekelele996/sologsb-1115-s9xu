/** 熏蒸处理单状态 */
export const FUMIGATION_STATUSES = ['待熏蒸', '熏蒸中', '已完成'] as const
export type FumigationStatus = (typeof FUMIGATION_STATUSES)[number]

/** 熏蒸处理单项状态 */
export const FUMIGATION_ITEM_STATUSES = ['待搬运', '在转运架', '已回迁', '回迁失败'] as const
export type FumigationItemStatus = (typeof FUMIGATION_ITEM_STATUSES)[number]

/** 插位（柜-屉-盒-位） */
export interface SlotPosition {
  cabinet: string
  drawer: number
  box: number
  slot: number
}

/** FumigationOrder 熏蒸处理单：处理组按单开工，整柜封闭 */
export interface FumigationOrder {
  id: string
  /** 处理单号，如 FUM-2026-0001 */
  orderNo: string
  /** 本单点到的柜（整柜封闭） */
  cabinets: string[]
  status: FumigationStatus
  createdAt: string
  startedAt?: string
  completedAt?: string
  handler: string
  note: string
}

/** FumigationItem 熏蒸处理单项：一份标本的搬运与回迁记录（处理侧自己的账） */
export interface FumigationItem {
  id: string
  orderId: string
  specimenId: string
  /** 出柜前的原插位快照（处理侧留底） */
  originalSlot: SlotPosition
  /** 熏蒸期间标本在转运架上的架位号 */
  transferSlot: string
  status: FumigationItemStatus
  /** 回迁被拦下的原因 */
  failReason?: string
  movedAt?: string
  movedBackAt?: string
}
