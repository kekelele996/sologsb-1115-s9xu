import { create } from 'zustand'
import type { Storage, TreatmentItem, TreatmentOrder } from '@/types'
import { db, deleteRow, loadAll, putRow } from '@/hooks/usePersistentStore'
import { uid } from '@/utils/id'
import { encodeSlot } from '@/utils/codec'
import {
  allocateRack,
  buildTreatmentCode,
  halfOfMonth,
  nextTreatmentSerial,
  originSlotText,
  returnSlotOccupant,
  sameCabinet
} from '@/utils/treatment'

/** 单份回迁结果 */
export interface ReturnOutcome {
  item: TreatmentItem
  ok: boolean
  /** 已经回迁过、本次直接跳过（幂等，不产生额外记录） */
  skipped?: boolean
  reason?: string
}

export interface BatchReturnResult {
  returned: number
  blocked: TreatmentItem[]
  skipped: number
  outcomes: ReturnOutcome[]
}

export interface TreatmentState {
  orders: TreatmentOrder[]
  items: TreatmentItem[]
  loaded: boolean
  hydrate: () => Promise<void>
  saveOrder: (row: TreatmentOrder) => Promise<void>
  saveItem: (row: TreatmentItem) => Promise<void>
  /** 开单：登记处理单（草稿），所选柜不得与正在熏蒸的柜重叠 */
  createOrder: (input: {
    cabinets: string[]
    handler: string
    note: string
    rackCount: number
    rackCapacity: number
  }) => Promise<{ ok: boolean; order?: TreatmentOrder; error?: string }>
  /** 删除草稿处理单（仅草稿可删，连带明细） */
  removeDraft: (orderId: string) => Promise<void>
  /**
   * 开工：整柜封闭。把所选柜里馆藏台账上的标本逐份抄成处理明细、移入转运架，
   * 原插位不动（仍算预留）。同一单重复开工不会多出明细或重复占架位（幂等）。
   */
  startOrder: (
    orderId: string
  ) => Promise<{ ok: boolean; evacuated: number; error?: string }>
  /** 逐份回迁：原插位被别的标本占住就只拦下这一份，仅回滚这一份 */
  returnItem: (orderId: string, itemId: string) => Promise<ReturnOutcome>
  /** 按处理单批量回迁，一份失败不影响其它份；同一张单再跑一次不会多出记录、不重复占位 */
  returnAll: (orderId: string) => Promise<BatchReturnResult>
  /** 全部回迁后解封结单 */
  finishOrder: (orderId: string) => Promise<{ ok: boolean; error?: string }>
}

const sortOrders = (rows: TreatmentOrder[]): TreatmentOrder[] =>
  rows.sort((a, b) => (b.createdDate + b.code).localeCompare(a.createdDate + a.code))

export const treatmentStore = create<TreatmentState>((set, get) => ({
  orders: [],
  items: [],
  loaded: false,

  hydrate: async () => {
    const [orders, items] = await Promise.all([
      loadAll<TreatmentOrder>(db.treatmentOrders),
      loadAll<TreatmentItem>(db.treatmentItems)
    ])
    set({ orders: sortOrders(orders), items, loaded: true })
  },

  saveOrder: async (row) => {
    await putRow<TreatmentOrder>(db.treatmentOrders, row)
    await get().hydrate()
  },

  saveItem: async (row) => {
    await putRow<TreatmentItem>(db.treatmentItems, row)
    await get().hydrate()
  },

  createOrder: async ({ cabinets, handler, note, rackCount, rackCapacity }) => {
    const list = Array.from(
      new Set(cabinets.map((name) => name.trim().toUpperCase()).filter(Boolean))
    )
    if (list.length === 0) return { ok: false, error: '请至少填写一只要熏蒸的标本柜' }
    if (rackCount < 1 || rackCapacity < 1) {
      return { ok: false, error: '转运架数与每架层位都必须大于 0' }
    }
    const overlap = get()
      .orders.filter((order) => order.status === '熏蒸中')
      .find((order) => order.cabinets.some((name) => list.some((input) => sameCabinet(name, input))))
    if (overlap) {
      return { ok: false, error: `柜 ${list.join('、')} 已被进行中的处理单 ${overlap.code} 封闭，请等其解封` }
    }
    const now = new Date()
    const year = now.getFullYear()
    const half = halfOfMonth(now.getMonth() + 1)
    const code = buildTreatmentCode(year, half, nextTreatmentSerial(get().orders.map((o) => o.code), year, half))
    const today = now.toISOString().slice(0, 10)
    const order: TreatmentOrder = {
      id: uid('fum'),
      code,
      cabinets: list,
      status: '草稿',
      createdDate: today,
      startedAt: '',
      finishedAt: '',
      handler: handler.trim(),
      note: note.trim(),
      rackCount,
      rackCapacity
    }
    await db.treatmentOrders.put(order)
    await get().hydrate()
    return { ok: true, order }
  },

  removeDraft: async (orderId) => {
    const order = get().orders.find((item) => item.id === orderId)
    if (!order || order.status !== '草稿') return
    await Promise.all(
      get()
        .items.filter((item) => item.orderId === orderId)
        .map((item) => deleteRow<TreatmentItem>(db.treatmentItems, item.id))
    )
    await deleteRow<TreatmentOrder>(db.treatmentOrders, orderId)
    await get().hydrate()
  },

  startOrder: async (orderId) => {
    const order = get().orders.find((item) => item.id === orderId)
    if (!order) return { ok: false, evacuated: 0, error: '处理单不存在' }
    if (order.status !== '草稿') return { ok: false, evacuated: 0, error: `处理单 ${order.code} 已开工，不能重复封闭` }

    let evacuated = 0
    await db.transaction('rw', db.treatmentOrders, db.treatmentItems, db.storages, db.specimens, async (tx) => {
      // 封闭柜不得与其它进行中的单重叠（开单后也可能有新单抢先封闭）
      const active = await tx.treatmentOrders.filter((o) => o.status === '熏蒸中').toArray()
      const clash = active.find((o) =>
        o.cabinets.some((name) => order.cabinets.some((input) => sameCabinet(name, input)))
      )
      if (clash) throw new Error(`所选柜已被处理单 ${clash.code} 封闭`)

      const [storages, specimens, existingItems] = await Promise.all([
        tx.storages.toArray(),
        tx.specimens.toArray(),
        tx.treatmentItems.where('orderId').equals(orderId).toArray()
      ])
      const codeOf = (specimenId: string): string =>
        specimens.find((sp) => sp.id === specimenId)?.code ?? specimenId

      // 幂等：已在本单里的标本不重复出明细、不重复占架位
      const doneSpecimenIds = new Set(existingItems.map((item) => item.specimenId))
      const inCabinet = storages
        .filter((storage) => order.cabinets.some((name) => sameCabinet(name, storage.cabinet)))
        .filter((storage) => !doneSpecimenIds.has(storage.specimenId))
        .sort(
          (a, b) =>
            encodeSlot(a.cabinet, a.drawer, a.box, a.slot).localeCompare(
              encodeSlot(b.cabinet, b.drawer, b.box, b.slot)
            )
        )

      const occupy = [...existingItems]
      const startedAt = new Date().toISOString()
      const newItems: TreatmentItem[] = []
      for (const storage of inCabinet) {
        const slot = allocateRack(occupy, order.rackCount, order.rackCapacity)
        if (!slot) {
          throw new Error(`转运架已全部放满（${order.rackCount} 架 × ${order.rackCapacity} 位），请先扩容再开工`)
        }
        const item: TreatmentItem = {
          id: uid('fumi'),
          orderId: order.id,
          specimenId: storage.specimenId,
          specimenCode: codeOf(storage.specimenId),
          origin: {
            method: storage.method,
            cabinet: storage.cabinet,
            drawer: storage.drawer,
            box: storage.box,
            slot: storage.slot
          },
          rack: slot.rack,
          rackSlot: slot.rackSlot,
          status: '已出柜',
          evacuatedAt: startedAt,
          returnedAt: '',
          blockerCode: '',
          lastResult: `已疏散至转运架 R${slot.rack}-S${String(slot.rackSlot).padStart(2, '0')}，原插位预留`
        }
        newItems.push(item)
        occupy.push(item)
        evacuated += 1
      }

      await tx.treatmentItems.bulkPut(newItems)
      await tx.treatmentOrders.put({ ...order, status: '熏蒸中', startedAt })
      // 注意：馆藏 storages 一行都不改 —— 原插位仍算预留，台账各记各的
    })
    await get().hydrate()
    return { ok: true, evacuated }
  },

  returnItem: async (orderId, itemId) => {
    const order = get().orders.find((item) => item.id === orderId)
    const item = get().items.find((entry) => entry.id === itemId)
    if (!order || !item) return { item: item as TreatmentItem, ok: false, reason: '处理明细不存在' }
    if (item.orderId !== orderId) return { item, ok: false, reason: '该明细不属于这张处理单' }
    if (order.status !== '熏蒸中') return { item, ok: false, reason: `处理单 ${order.code} 不在熏蒸中` }

    // 幂等：已经回迁过的不产生新记录、不重复占位
    if (item.status === '已回迁') {
      return { item, ok: true, skipped: true }
    }

    try {
      const blockedBy = await db.transaction(
        'rw',
        db.treatmentItems,
        db.storages,
        db.specimens,
        async (tx) => {
          const storages = await tx.storages.toArray()
          const specimens = await tx.specimens.toArray()
          const codeOf = (specimenId: string): string =>
            specimens.find((sp) => sp.id === specimenId)?.code ?? specimenId

          // 对账：此刻原插位若被「别的标本」占住，拦下这一份 ——
          // 只落受阻记录、不写 storages；这一份自己的改动到此为止，不影响同批其它份。
          const occupant = returnSlotOccupant(storages, item)
          if (occupant) {
            const blockerCode = codeOf(occupant.specimenId)
            await tx.treatmentItems.put({
              ...item,
              status: '回迁受阻',
              blockerCode,
              lastResult: `回迁被拦下：原插位 ${originSlotText(item)} 现由 ${blockerCode} 占住`
            })
            return blockerCode
          }

          // 放回原插位：该标本已有馆藏记录就原位更新，没有则补一条；不新增重复记录
          const existing = storages.find((storage) => storage.specimenId === item.specimenId)
          const today = new Date().toISOString().slice(0, 10)
          const restored: Storage = {
            id: existing?.id ?? uid('stg'),
            specimenId: item.specimenId,
            method: item.origin.method as Storage['method'],
            cabinet: item.origin.cabinet,
            drawer: item.origin.drawer,
            box: item.origin.box,
            slot: item.origin.slot,
            storedDate: existing?.storedDate ?? today,
            handler: existing?.handler ?? order.handler
          }
          await tx.storages.put(restored)
          await tx.treatmentItems.put({
            ...item,
            status: '已回迁',
            returnedAt: new Date().toISOString(),
            blockerCode: '',
            lastResult: `已回迁原插位 ${originSlotText(item)}`
          })
          return ''
        }
      )
      await get().hydrate()
      const fresh = get().items.find((entry) => entry.id === itemId) ?? item
      if (blockedBy) {
        return { item: fresh, ok: false, reason: `原插位被 ${blockedBy} 占住，已拦下这一份` }
      }
      return { item: fresh, ok: true }
    } catch (error) {
      await get().hydrate()
      const fresh = get().items.find((entry) => entry.id === itemId) ?? item
      return { item: fresh, ok: false, reason: error instanceof Error ? error.message : String(error) }
    }
  },

  returnAll: async (orderId) => {
    const result: BatchReturnResult = { returned: 0, blocked: [], skipped: 0, outcomes: [] }
    // 逐份独立事务：一批里某份失败，只回滚那一份，其它份照常回迁
    const pending = get().items.filter(
      (item) => item.orderId === orderId && item.status !== '已回迁'
    )
    for (const item of pending) {
      const outcome = await get().returnItem(orderId, item.id)
      result.outcomes.push(outcome)
      if (outcome.skipped) result.skipped += 1
      else if (outcome.ok) result.returned += 1
      else result.blocked.push(outcome.item)
    }
    return result
  },

  finishOrder: async (orderId) => {
    const order = get().orders.find((item) => item.id === orderId)
    if (!order) return { ok: false, error: '处理单不存在' }
    if (order.status !== '熏蒸中') return { ok: false, error: `处理单 ${order.code} 不在熏蒸中` }
    const waiting = get().items.filter(
      (item) => item.orderId === orderId && item.status !== '已回迁'
    )
    if (waiting.length > 0) {
      return { ok: false, error: `还有 ${waiting.length} 份未回迁（含回迁受阻），不能解封结单` }
    }
    await db.treatmentOrders.put({ ...order, status: '已完成', finishedAt: new Date().toISOString() })
    await get().hydrate()
    return { ok: true }
  }
}))
