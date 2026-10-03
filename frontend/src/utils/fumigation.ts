import type { FumigationItem, FumigationOrder, SlotPosition } from '@/types'
import { encodeSlot } from './codec'

/** 插位唯一键：柜-屉-盒-位 */
export function slotKey(pos: SlotPosition): string {
  return encodeSlot(pos.cabinet, pos.drawer, pos.box, pos.slot)
}

/** 生成下一个处理单号：FUM-年份-流水号 */
export function nextOrderNo(existing: FumigationOrder[], year: number | string = new Date().getFullYear()): string {
  const prefix = `FUM-${year}-`
  const serials = existing
    .map((order) => order.orderNo)
    .filter((no) => no.startsWith(prefix))
    .map((no) => Number(no.slice(prefix.length)))
    .filter((n) => Number.isFinite(n))
  const next = serials.length > 0 ? Math.max(...serials) + 1 : 1
  return `${prefix}${String(next).padStart(4, '0')}`
}

/** 标本处理状态（用于标本清单筛选与徽标） */
export type ProcessingStatus = '未处理' | '待熏蒸' | '熏蒸中' | '已回迁'

/**
 * 依据处理侧记录推导标本当前的处理状态：
 * - 熏蒸中：在「熏蒸中」的单上且标本在转运架（或回迁失败待处理）
 * - 待熏蒸：在「待熏蒸」的单上（已排期，尚未搬运）
 * - 已回迁：最近一单已完成且标本已回迁
 * - 未处理：从未上过处理单
 */
export function specimenProcessingStatus(
  orders: FumigationOrder[],
  items: FumigationItem[],
  specimenId: string
): ProcessingStatus {
  const mine = items.filter((item) => item.specimenId === specimenId)
  if (mine.length === 0) return '未处理'
  // 最近一张单（按处理单创建时间）
  const latest = mine
    .map((item) => ({ item, order: orders.find((o) => o.id === item.orderId) }))
    .filter((x): x is { item: FumigationItem; order: FumigationOrder } => Boolean(x.order))
    .sort((a, b) => b.order.createdAt.localeCompare(a.order.createdAt))[0]
  if (!latest) return '未处理'
  const { order, item } = latest
  if (order.status === '熏蒸中') {
    return item.status === '已回迁' ? '已回迁' : '熏蒸中'
  }
  if (order.status === '待熏蒸') return '待熏蒸'
  if (order.status === '已完成') return '已回迁'
  return '未处理'
}

/** 处于熏蒸中（在转运架或回迁失败）的标本 id 集合 —— 用于柜位图徽标与出柜保护 */
export function inTransferSpecimenIds(orders: FumigationOrder[], items: FumigationItem[]): Set<string> {
  const activeOrderIds = new Set(orders.filter((o) => o.status === '熏蒸中').map((o) => o.id))
  return new Set(
    items
      .filter((item) => activeOrderIds.has(item.orderId) && item.status !== '已回迁')
      .map((item) => item.specimenId)
  )
}

/** 指定柜是否被某张「熏蒸中」的单整柜封闭 */
export function isCabinetSealed(orders: FumigationOrder[], cabinet: string): boolean {
  const target = cabinet.toUpperCase()
  return orders.some((order) => order.status === '熏蒸中' && order.cabinets.some((c) => c.toUpperCase() === target))
}

/** 所有被封闭的柜集合 */
export function sealedCabinets(orders: FumigationOrder[]): Set<string> {
  return new Set(orders.filter((o) => o.status === '熏蒸中').flatMap((o) => o.cabinets.map((c) => c.toUpperCase())))
}
