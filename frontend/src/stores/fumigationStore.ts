import { create } from 'zustand'
import type { FumigationItem, FumigationOrder, Storage } from '@/types'
import { db, deleteRow, loadAll, putRow, putRows } from '@/hooks/usePersistentStore'
import { uid } from '@/utils/id'
import { nextOrderNo, slotKey } from '@/utils/fumigation'

export interface MoveBackResult {
  moved: number
  blocked: number
  /** 被拦下的明细：标本编号 + 原因 */
  blockedItems: { code: string; reason: string }[]
}

export interface FumigationState {
  orders: FumigationOrder[]
  items: FumigationItem[]
  loaded: boolean
  hydrate: () => Promise<void>
  /** 创建处理单：快照选中柜里的标本（已在处理单上的标本自动剔除） */
  createOrder: (
    cabinets: string[],
    handler: string,
    note: string,
    storages: Storage[]
  ) => Promise<{ order: FumigationOrder; excluded: number }>
  /** 开始熏蒸：柜整柜封闭，标本搬到转运架，原插位保留 */
  startFumigation: (orderId: string) => Promise<void>
  /** 逐份回迁：原插位被别的标本占住就拦下这一份；幂等，已回迁的跳过 */
  moveBack: (orderId: string, storages: Storage[], codeOf: (specimenId: string) => string) => Promise<MoveBackResult>
  /** 删除处理单（待熏蒸 / 已完成 可删；熏蒸中需先回迁） */
  removeOrder: (orderId: string) => Promise<{ ok: boolean; reason?: string }>
}

export const fumigationStore = create<FumigationState>((set, get) => ({
  orders: [],
  items: [],
  loaded: false,
  hydrate: async () => {
    const [orders, items] = await Promise.all([
      loadAll<FumigationOrder>(db.fumigationOrders),
      loadAll<FumigationItem>(db.fumigationItems)
    ])
    orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    items.sort((a, b) => (a.transferSlot || a.id).localeCompare(b.transferSlot || b.id))
    set({ orders, items, loaded: true })
  },

  createOrder: async (cabinets, handler, note, storages) => {
    const existing = get().orders
    const order: FumigationOrder = {
      id: uid('fum'),
      orderNo: nextOrderNo(existing),
      cabinets: Array.from(new Set(cabinets.map((c) => c.toUpperCase()))).filter(Boolean),
      status: '待熏蒸',
      createdAt: new Date().toISOString(),
      handler: handler.trim(),
      note: note.trim()
    }
    // 已在处理单上（未完成）的标本不再重复拉单
    const busySpecimenIds = new Set(
      get()
        .items.filter((item) => {
          const o = get().orders.find((ord) => ord.id === item.orderId)
          return o && o.status !== '已完成'
        })
        .map((item) => item.specimenId)
    )
    const targets = storages.filter(
      (s) => order.cabinets.includes(s.cabinet.toUpperCase()) && !busySpecimenIds.has(s.specimenId)
    )
    const items: FumigationItem[] = targets.map((s) => ({
      id: uid('fmi'),
      orderId: order.id,
      specimenId: s.specimenId,
      originalSlot: { cabinet: s.cabinet, drawer: s.drawer, box: s.box, slot: s.slot },
      transferSlot: '',
      status: '待搬运'
    }))
    await putRow<FumigationOrder>(db.fumigationOrders, order)
    if (items.length > 0) await putRows<FumigationItem>(db.fumigationItems, items)
    await get().hydrate()
    return { order, excluded: busySpecimenIds.size }
  },

  startFumigation: async (orderId) => {
    const order = get().orders.find((o) => o.id === orderId)
    if (!order || order.status !== '待熏蒸') return
    const orderItems = get().items.filter((i) => i.orderId === orderId)
    // 顺序分配转运架位（跳过已被占用的架位）
    const used = new Set(
      get()
        .items.filter((i) => i.status === '在转运架' && i.transferSlot)
        .map((i) => i.transferSlot)
    )
    let cursor = 1
    const updated: FumigationItem[] = orderItems.map((item) => {
      if (item.status !== '待搬运') return item
      let slot = `ZYJ-${String(cursor).padStart(3, '0')}`
      while (used.has(slot)) {
        cursor += 1
        slot = `ZYJ-${String(cursor).padStart(3, '0')}`
      }
      used.add(slot)
      return { ...item, transferSlot: slot, status: '在转运架', movedAt: new Date().toISOString() }
    })
    await putRows<FumigationItem>(db.fumigationItems, updated)
    await putRow<FumigationOrder>(db.fumigationOrders, {
      ...order,
      status: '熏蒸中',
      startedAt: new Date().toISOString()
    })
    await get().hydrate()
  },

  moveBack: async (orderId, storages, codeOf) => {
    const order = get().orders.find((o) => o.id === orderId)
    if (!order || order.status !== '熏蒸中') return { moved: 0, blocked: 0, blockedItems: [] }
    const orderItems = get().items.filter((i) => i.orderId === orderId)

    const updated: FumigationItem[] = []
    const blockedItems: { code: string; reason: string }[] = []
    let moved = 0
    let blocked = 0

    for (const item of orderItems) {
      // 幂等：已回迁的跳过，不重复占位、不重复落记录
      if (item.status === '已回迁') {
        updated.push(item)
        continue
      }
      const key = slotKey(item.originalSlot)
      const existing = storages.find((s) => slotKey(s) === key)
      if (existing && existing.specimenId !== item.specimenId) {
        // 原插位被别的标本占住 → 拦下这一份（只回滚这一份，不影响其他份）
        blocked += 1
        blockedItems.push({
          code: codeOf(item.specimenId),
          reason: `原插位 ${key} 已被 ${codeOf(existing.specimenId)} 占用`
        })
        updated.push({ ...item, status: '回迁失败', failReason: `原插位 ${key} 已被 ${codeOf(existing.specimenId)} 占用` })
        continue
      }
      if (!existing) {
        // 异常兜底：原插位记录已不在，补一条入柜记录
        await putRow<Storage>(db.storages, {
          id: uid('stg'),
          specimenId: item.specimenId,
          method: '针插',
          cabinet: item.originalSlot.cabinet,
          drawer: item.originalSlot.drawer,
          box: item.originalSlot.box,
          slot: item.originalSlot.slot,
          storedDate: new Date().toISOString().slice(0, 10),
          handler: ''
        })
      }
      moved += 1
      updated.push({
        ...item,
        status: '已回迁',
        failReason: undefined,
        movedBackAt: new Date().toISOString()
      })
    }

    await putRows<FumigationItem>(db.fumigationItems, updated)
    const allDone = updated.every((i) => i.status === '已回迁')
    if (allDone) {
      await putRow<FumigationOrder>(db.fumigationOrders, {
        ...order,
        status: '已完成',
        completedAt: new Date().toISOString()
      })
    }
    await get().hydrate()
    return { moved, blocked, blockedItems }
  },

  removeOrder: async (orderId) => {
    const order = get().orders.find((o) => o.id === orderId)
    if (!order) return { ok: false, reason: '处理单不存在' }
    if (order.status === '熏蒸中') return { ok: false, reason: '熏蒸中的处理单需先完成回迁，不能删除' }
    const itemIds = get().items.filter((i) => i.orderId === orderId).map((i) => i.id)
    await Promise.all([
      deleteRow<FumigationOrder>(db.fumigationOrders, orderId),
      ...itemIds.map((id) => deleteRow<FumigationItem>(db.fumigationItems, id))
    ])
    await get().hydrate()
    return { ok: true }
  }
}))
