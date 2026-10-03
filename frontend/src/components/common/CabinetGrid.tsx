import type { ReactNode } from 'react'
import type { Storage } from '@/types'
import { encodeSlot } from '@/utils/codec'

/** 预留插位（熏蒸疏散后，处理组仍占着的原插位；馆藏台账此刻可能为空或已漂移） */
export interface ReservedSlot {
  key: string
  specimenCode: string
  status: string
}

export interface CabinetGridProps {
  cabinet: string
  drawers: number
  boxes: number
  slots: number
  storages: Storage[]
  /** 熏蒸预留插位（key 为 encodeSlot 结果） */
  reserved?: ReservedSlot[]
  /** 当前柜是否处于熏蒸封闭 */
  sealed?: boolean
  /** 每个标本编号，用于显示占用 */
  codeOf: (specimenId: string) => string
  /** 当前拖拽中的标本编号 */
  draggingCode: string | null
  /** 点击或拖放到某个插位 */
  onDropSlot: (payload: { cabinet: string; drawer: number; box: number; slot: number }) => void
  onPickStorage?: (storage: Storage) => void
  /** 点击预留插位（熏蒸封闭中不可再入柜） */
  onPickReserved?: (reserved: ReservedSlot) => void
  footer?: ReactNode
}

/** 柜位网格：柜 → 抽屉 → 盒 → 插位，插位作为拖放目标 */
export default function CabinetGrid({
  cabinet,
  drawers,
  boxes,
  slots,
  storages,
  reserved = [],
  sealed = false,
  codeOf,
  draggingCode,
  onDropSlot,
  onPickStorage,
  onPickReserved,
  footer
}: CabinetGridProps): JSX.Element {
  const drawerList = Array.from({ length: drawers }, (_, index) => index + 1)
  const boxList = Array.from({ length: boxes }, (_, index) => index + 1)
  const slotList = Array.from({ length: slots }, (_, index) => index + 1)

  const slotMap = new Map<string, Storage>()
  storages
    .filter((item) => item.cabinet.toUpperCase() === cabinet.toUpperCase())
    .forEach((item) => slotMap.set(encodeSlot(item.cabinet, item.drawer, item.box, item.slot), item))

  const reservedMap = new Map<string, ReservedSlot>()
  reserved.forEach((item) => reservedMap.set(item.key, item))

  return (
    <div className="flex flex-col gap-4" data-testid="cabinet-grid">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          标本柜 {cabinet} · {drawers} 抽屉 × {boxes} 盒 × {slots} 位
          {sealed ? (
            <span className="rounded-full border border-indigo-300 bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">
              熏蒸封闭中 · 暂缓入柜
            </span>
          ) : null}
        </h3>
        <span className="text-xs text-slate-500">
          {sealed
            ? '本柜整柜熏蒸封闭，标本已转至转运架，原插位预留，暂不接受入柜'
            : draggingCode
              ? `正在拖动 ${draggingCode}，点击任一空插位即可放置`
              : '从右侧未入柜列表拖动标本到插位'}
        </span>
      </div>
      {drawerList.map((drawer) => (
        <section key={drawer} className="rounded-xl border border-slate-200 bg-white p-3">
          <header className="mb-2 text-xs font-medium text-slate-500">抽屉 D{drawer}</header>
          <div className="flex flex-col gap-3">
            {boxList.map((box) => (
              <div key={box} className="flex flex-wrap items-center gap-2">
                <span className="w-16 text-xs text-slate-500">盒 B{String(box).padStart(2, '0')}</span>
                <div className="flex flex-wrap gap-1.5">
                  {slotList.map((slot) => {
                    const key = encodeSlot(cabinet, drawer, box, slot)
                    const storage = slotMap.get(key)
                    const reservedSlot = reservedMap.get(key)
                    const code = storage ? codeOf(storage.specimenId) : ''
                    const click = (): void => {
                      if (reservedSlot) {
                        onPickReserved?.(reservedSlot)
                        return
                      }
                      if (storage && onPickStorage) onPickStorage(storage)
                      else onDropSlot({ cabinet, drawer, box, slot })
                    }
                    return (
                      <button
                        key={slot}
                        type="button"
                        title={
                          reservedSlot
                            ? `预留：${reservedSlot.specimenCode}（${reservedSlot.status}，熏蒸期间不得占用）`
                            : storage
                              ? `占用：${code}`
                              : '空位'
                        }
                        onClick={click}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                          event.preventDefault()
                          click()
                        }}
                        className={`h-12 w-16 rounded-md border text-[11px] leading-tight transition ${
                          reservedSlot
                            ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
                            : storage
                              ? 'border-field-500 bg-field-50 text-field-700 hover:bg-field-100'
                              : 'border-dashed border-slate-300 bg-slate-50 text-slate-400 hover:border-field-500 hover:text-field-600'
                        }`}
                      >
                        <span className="block truncate font-mono">
                          {reservedSlot ? reservedSlot.specimenCode : storage ? code : `S${String(slot).padStart(2, '0')}`}
                        </span>
                        <span className="block">
                          {reservedSlot
                            ? reservedSlot.status === '回迁受阻'
                              ? '预留·受阻'
                              : '预留'
                            : storage
                              ? '占用'
                              : '空位'}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
      {footer}
    </div>
  )
}
