/** 熏蒸处理单状态：草稿（已开单未封闭）/ 熏蒸中（整柜封闭）/ 已完成（全部回迁并解封） */
export const TREATMENT_ORDER_STATUSES = ['草稿', '熏蒸中', '已完成'] as const
export type TreatmentOrderStatus = (typeof TREATMENT_ORDER_STATUSES)[number]

/**
 * 单份标本的处理状态：
 * - 已出柜 evacuated：已从原插位移入转运架，原插位仍算预留
 * - 回迁受阻 blocked：回迁时原插位已被别的标本占住，这一份被拦下，仍在转运架
 * - 已回迁 returned：已回到原插位
 */
export const TREATMENT_ITEM_STATUSES = ['已出柜', '回迁受阻', '已回迁'] as const
export type TreatmentItemStatus = (typeof TREATMENT_ITEM_STATUSES)[number]

/** 标本清单里的处理状态筛选项：未处理 不落在任何处理明细上 */
export const TREATMENT_FILTER_STATUSES = ['未处理', ...TREATMENT_ITEM_STATUSES] as const
export type TreatmentFilterStatus = (typeof TREATMENT_FILTER_STATUSES)[number]

/** 原插位快照：开工瞬间从馆藏台账抄下，处理组自己留底，后续只以它为回迁依据 */
export interface OriginSlot {
  method: string
  cabinet: string
  drawer: number
  box: number
  slot: number
}

/** TreatmentOrder 熏蒸处理单：处理组开工的凭据，一张单点到几只柜子 */
export interface TreatmentOrder {
  id: string
  /** 处理单号：FUM-年份H上半年/下半年-流水号，如 FUM-2026H2-001 */
  code: string
  /** 本单封闭熏蒸的标本柜编号 */
  cabinets: string[]
  status: TreatmentOrderStatus
  /** 开单日期 */
  createdDate: string
  /** 开工（整柜封闭、批量疏散）时间 */
  startedAt: string
  /** 完成（全部回迁、解封）时间 */
  finishedAt: string
  /** 处理人 */
  handler: string
  note: string
  /** 开工时本单转运架规模：架数 × 每架层位数 */
  rackCount: number
  rackCapacity: number
}

/** TreatmentItem 处理明细：一张处理单里一份标本一份，处理组自己的那份账 */
export interface TreatmentItem {
  id: string
  orderId: string
  specimenId: string
  /** 开工瞬间抄下的标本编号，馆藏那头改了编号也对得上账 */
  specimenCode: string
  origin: OriginSlot
  /** 转运架位：转运架号 + 层位号，熏蒸期间标本的实际位置 */
  rack: number
  rackSlot: number
  status: TreatmentItemStatus
  evacuatedAt: string
  returnedAt: string
  /** 回迁受阻时占住原插位的标本编号（拦下原因），成功回迁后清空 */
  blockerCode: string
  /** 回迁结果说明（含历次受阻原因），供处理单留痕 */
  lastResult: string
}
