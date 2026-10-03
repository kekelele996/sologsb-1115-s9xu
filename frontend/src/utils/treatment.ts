import type { Storage, TreatmentItem, TreatmentOrder } from '@/types'
import { encodeSlot } from '@/utils/codec'

/** 处理单号：FUM-2026H1-001（H1 上半年 / H2 下半年） */
export function buildTreatmentCode(year: number | string, half: 1 | 2, serial: number): string {
  return `FUM-${year}H${half}-${String(serial).padStart(3, '0')}`
}

/** 依据日期判断半年：1–6 月 H1，7–12 月 H2 */
export function halfOfMonth(month: number): 1 | 2 {
  return month <= 6 ? 1 : 2
}

/** 依据已有单号生成下一个流水号（同年同半年） */
export function nextTreatmentSerial(existingCodes: string[], year: number | string, half: 1 | 2): number {
  const prefix = `FUM-${year}H${half}-`
  const serials = existingCodes
    .map((code) => (code.startsWith(prefix) ? Number(code.slice(prefix.length)) : NaN))
    .filter((value) => Number.isFinite(value))
  return serials.length > 0 ? Math.max(...serials) + 1 : 1
}

/** 转运架位编码：R1-S03（架 1 · 层位 03） */
export function encodeRack(rack: number, rackSlot: number): string {
  return `R${rack}-S${String(rackSlot).padStart(2, '0')}`
}

/** 明细在原柜的预留插位编码 */
export function originSlotText(item: TreatmentItem): string {
  return encodeSlot(item.origin.cabinet, item.origin.drawer, item.origin.box, item.origin.slot)
}

/** 进行中（整柜封闭）的处理单 */
export function activeOrders(orders: TreatmentOrder[]): TreatmentOrder[] {
  return orders.filter((order) => order.status === '熏蒸中')
}

/** 柜号归一化比较 */
export function sameCabinet(a: string, b: string): boolean {
  return a.trim().toUpperCase() === b.trim().toUpperCase()
}

/** 该柜当前是否处于熏蒸封闭（任意一张进行中的单点到） */
export function isCabinetSealed(orders: TreatmentOrder[], cabinet: string): boolean {
  return activeOrders(orders).some((order) => order.cabinets.some((name) => sameCabinet(name, cabinet)))
}

/** 封闭某柜的进行中处理单（可能有多个） */
export function sealingOrdersOf(orders: TreatmentOrder[], cabinet: string): TreatmentOrder[] {
  return activeOrders(orders).filter((order) => order.cabinets.some((name) => sameCabinet(name, cabinet)))
}

/** 占用某转运架位的未回迁明细（跨所有进行中的处理单），传入 itemId 时忽略自身 */
export function rackOccupant(
  items: TreatmentItem[],
  rack: number,
  rackSlot: number,
  excludeItemId = ''
): TreatmentItem | null {
  return (
    items.find(
      (item) =>
        item.status !== '已回迁' &&
        item.id !== excludeItemId &&
        item.rack === rack &&
        item.rackSlot === rackSlot
    ) ?? null
  )
}

/**
 * 在给定架数 × 每架容量范围内顺序分配下一个空转运架位；
 * 已占满时返回 null（开工校验用）。
 */
export function allocateRack(
  items: TreatmentItem[],
  rackCount: number,
  rackCapacity: number,
  excludeItemId = ''
): { rack: number; rackSlot: number } | null {
  for (let rack = 1; rack <= rackCount; rack += 1) {
    for (let rackSlot = 1; rackSlot <= rackCapacity; rackSlot += 1) {
      if (!rackOccupant(items, rack, rackSlot, excludeItemId)) {
        return { rack, rackSlot }
      }
    }
  }
  return null
}

/**
 * 回迁对账：查馆藏台账里此刻占住某份明细原插位的标本。
 * 只有「别的标本」占住才算冲突；该份自己（含出柜期间台账未摘的原记录）与空位都放行。
 */
export function returnSlotOccupant(storages: Storage[], item: TreatmentItem): Storage | null {
  const key = originSlotText(item)
  return (
    storages.find(
      (storage) =>
        encodeSlot(storage.cabinet, storage.drawer, storage.box, storage.slot) === key &&
        storage.specimenId !== item.specimenId
    ) ?? null
  )
}

/** 一份明细在馆藏台账当前的柜位记录（可能与原插位不一致 —— 两边台账有漂移） */
export function storageOfSpecimen(storages: Storage[], specimenId: string): Storage | null {
  return storages.find((storage) => storage.specimenId === specimenId) ?? null
}

/**
 * 一份标本当前的处理状态：
 * 优先进行中处理单（熏蒸中 > 草稿明细不应存在，草稿无明细），其次最近开工单的明细；
 * 落在已完成单上则视为已回迁。供标本清单按处理状态筛选。
 */
export function latestTreatmentOf(
  orders: TreatmentOrder[],
  items: TreatmentItem[],
  specimenId: string
): { order: TreatmentOrder; item: TreatmentItem } | null {
  const mine = items
    .filter((item) => item.specimenId === specimenId)
    .map((item) => ({ item, order: orders.find((order) => order.id === item.orderId) }))
    .filter((entry): entry is { item: TreatmentItem; order: TreatmentOrder } => Boolean(entry.order))
  if (mine.length === 0) return null
  const active = mine.find((entry) => entry.order.status === '熏蒸中')
  if (active) return active
  mine.sort((a, b) => b.order.startedAt.localeCompare(a.order.startedAt))
  return mine[0]
}
