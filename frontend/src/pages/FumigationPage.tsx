import { useMemo, useState } from 'react'
import type { FumigationItem, FumigationOrder, FumigationStatus } from '@/types'
import { usePersistentStore } from '@/hooks/usePersistentStore'
import { fumigationStore } from '@/stores/fumigationStore'
import { specimenStore } from '@/stores/specimenStore'
import { storageStore } from '@/stores/storageStore'
import { storageSlotText } from '@/utils/codec'

const ORDER_STATUS_STYLES: Record<FumigationStatus, string> = {
  待熏蒸: 'bg-violet-50 text-violet-700 border-violet-300',
  熏蒸中: 'bg-amber-50 text-amber-700 border-amber-300',
  已完成: 'bg-emerald-50 text-emerald-700 border-emerald-300'
}

function OrderStatusBadge({ status }: { status: FumigationStatus }): JSX.Element {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs leading-5 ${ORDER_STATUS_STYLES[status]}`}
    >
      {status}
    </span>
  )
}

function itemStatusText(item: FumigationItem): string {
  if (item.status === '回迁失败') return `回迁失败：${item.failReason ?? ''}`
  return item.status
}

/** 熏蒸处理：按处理单整柜封闭、标本进转运架、熏蒸后逐份回迁（原插位被占则拦下该份） */
export default function FumigationPage(): JSX.Element {
  const orders = usePersistentStore(fumigationStore, (state) => state.orders)
  const items = usePersistentStore(fumigationStore, (state) => state.items)
  const specimens = usePersistentStore(specimenStore, (state) => state.rows)
  const storages = usePersistentStore(storageStore, (state) => state.rows)

  const [selectedCabinets, setSelectedCabinets] = useState<string[]>([])
  const [handler, setHandler] = useState('')
  const [note, setNote] = useState('')
  const [expandedId, setExpandedId] = useState<string>('')
  const [message, setMessage] = useState('')
  const [warning, setWarning] = useState('')
  const [busy, setBusy] = useState(false)

  const codeOf = (specimenId: string): string => specimens.find((item) => item.id === specimenId)?.code ?? '未知'

  /** 馆藏中所有出现过的柜（供勾选） */
  const cabinetOptions = useMemo(() => {
    const map = new Map<string, number>()
    storages.forEach((s) => {
      const key = s.cabinet.toUpperCase()
      map.set(key, (map.get(key) ?? 0) + 1)
    })
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([cabinet, count]) => ({ cabinet, count }))
  }, [storages])

  const toggleCabinet = (cabinet: string): void => {
    setSelectedCabinets((prev) =>
      prev.includes(cabinet) ? prev.filter((c) => c !== cabinet) : [...prev, cabinet]
    )
  }

  /** 勾选柜里、且尚未上过处理单的标本数（预演） */
  const previewCount = useMemo(() => {
    if (selectedCabinets.length === 0) return 0
    const busySpecimenIds = new Set(
      items
        .filter((item) => {
          const o = orders.find((ord) => ord.id === item.orderId)
          return o && o.status !== '已完成'
        })
        .map((item) => item.specimenId)
    )
    return storages.filter(
      (s) => selectedCabinets.includes(s.cabinet.toUpperCase()) && !busySpecimenIds.has(s.specimenId)
    ).length
  }, [selectedCabinets, storages, items, orders])

  const create = async (): Promise<void> => {
    if (selectedCabinets.length === 0) {
      setWarning('请先勾选要熏蒸的柜')
      return
    }
    setBusy(true)
    setWarning('')
    const { order, excluded } = await fumigationStore
      .getState()
      .createOrder(selectedCabinets, handler, note, storages)
    setBusy(false)
    setSelectedCabinets([])
    setNote('')
    setMessage(
      `已创建处理单 ${order.orderNo}，点到 ${order.cabinets.join('、')} 柜，共 ${
        items.filter((i) => i.orderId === order.id).length
      } 份标本待搬运` + (excluded > 0 ? `（${excluded} 份已在处理单上，自动剔除）` : '')
    )
    setExpandedId(order.id)
  }

  const start = async (order: FumigationOrder): Promise<void> => {
    setBusy(true)
    setWarning('')
    await fumigationStore.getState().startFumigation(order.id)
    setBusy(false)
    setMessage(`处理单 ${order.orderNo} 已开始熏蒸：${order.cabinets.join('、')} 柜整柜封闭，标本已进转运架`)
    setExpandedId(order.id)
  }

  const moveBack = async (order: FumigationOrder): Promise<void> => {
    setBusy(true)
    setWarning('')
    const result = await fumigationStore.getState().moveBack(order.id, storages, codeOf)
    setBusy(false)
    if (result.blocked > 0) {
      setWarning(
        `回迁完成：成功 ${result.moved} 份，拦下 ${result.blocked} 份。被拦下的标本原插位已被占用，请处理后再点「回迁」重试（已回迁的不会重复占位）。`
      )
    } else {
      setMessage(`回迁完成：${result.moved} 份全部回迁至原插位，处理单 ${order.orderNo} 已完成`)
    }
    setExpandedId(order.id)
  }

  const remove = async (order: FumigationOrder): Promise<void> => {
    const result = await fumigationStore.getState().removeOrder(order.id)
    if (!result.ok) {
      setWarning(result.reason ?? '删除失败')
      return
    }
    setMessage(`处理单 ${order.orderNo} 已删除`)
    if (expandedId === order.id) setExpandedId('')
  }

  const itemsOf = (orderId: string): FumigationItem[] =>
    items.filter((item) => item.orderId === orderId).sort((a, b) => a.transferSlot.localeCompare(b.transferSlot))

  const progressOf = (orderId: string): { done: number; total: number } => {
    const list = itemsOf(orderId)
    return { done: list.filter((i) => i.status === '已回迁').length, total: list.length }
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="page-title">熏蒸处理</h1>
        <p className="page-sub">
          按处理单整柜封闭，柜里标本先搬进转运架位（原插位仍算预留）；熏蒸期间鉴定照旧落记录，入柜先缓一缓；
          熏蒸完逐份回迁，原插位被别人占住就先拦下这一份。
        </p>
      </header>

      {warning ? <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">{warning}</p> : null}
      {message ? <p className="rounded-lg border border-field-100 bg-field-50 px-3 py-2 text-sm text-field-700">{message}</p> : null}

      <section className="panel">
        <h2 className="text-sm font-semibold text-slate-700">新建处理单</h2>
        <p className="mt-0.5 text-xs text-slate-500">勾选本单要熏蒸的柜（整柜封闭），处理组按单开工。</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {cabinetOptions.length === 0 ? (
            <p className="text-xs text-slate-400">暂无在柜标本，请先到「保藏柜位图」入柜</p>
          ) : (
            cabinetOptions.map(({ cabinet, count }) => (
              <button
                key={cabinet}
                type="button"
                onClick={() => toggleCabinet(cabinet)}
                className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                  selectedCabinets.includes(cabinet)
                    ? 'border-field-500 bg-field-50 text-field-700'
                    : 'border-slate-300 bg-white text-slate-700 hover:border-field-500'
                }`}
              >
                {cabinet}
                <span className="ml-1.5 text-xs text-slate-400">{count} 份</span>
              </button>
            ))
          )}
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div>
            <span className="field-label">经手人</span>
            <input className="field-input" value={handler} onChange={(e) => setHandler(e.target.value)} placeholder="如 覃羽" />
          </div>
          <div>
            <span className="field-label">备注</span>
            <input className="field-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="如 上半年熏蒸" />
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button className="btn-primary" type="button" disabled={busy || selectedCabinets.length === 0} onClick={() => void create()}>
            创建处理单（{previewCount} 份）
          </button>
          <span className="text-xs text-slate-500">
            已选 {selectedCabinets.length} 个柜：{selectedCabinets.join('、') || '—'}
          </span>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        {orders.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-400">
            暂无处理单，勾选上方柜创建第一张熏蒸处理单
          </p>
        ) : (
          orders.map((order) => {
            const list = itemsOf(order.id)
            const progress = progressOf(order.id)
            const expanded = expandedId === order.id
            return (
              <article key={order.id} className="panel">
                <header className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <h3 className="font-mono text-sm font-semibold text-field-700">{order.orderNo}</h3>
                    <OrderStatusBadge status={order.status} />
                    <span className="text-xs text-slate-500">
                      柜：{order.cabinets.join('、')} · {list.length} 份
                    </span>
                    {order.status === '熏蒸中' ? (
                      <span className="text-xs text-amber-700">
                        回迁 {progress.done}/{progress.total}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button className="btn-ghost" type="button" onClick={() => setExpandedId(expanded ? '' : order.id)}>
                      {expanded ? '收起' : '查看明细'}
                    </button>
                    {order.status === '待熏蒸' ? (
                      <>
                        <button className="btn-primary" type="button" disabled={busy} onClick={() => void start(order)}>
                          开始熏蒸
                        </button>
                        <button className="btn-danger" type="button" onClick={() => void remove(order)}>
                          删除
                        </button>
                      </>
                    ) : null}
                    {order.status === '熏蒸中' ? (
                      <button className="btn-primary" type="button" disabled={busy} onClick={() => void moveBack(order)}>
                        逐份回迁
                      </button>
                    ) : null}
                    {order.status === '已完成' ? (
                      <button className="btn-danger" type="button" onClick={() => void remove(order)}>
                        删除
                      </button>
                    ) : null}
                  </div>
                </header>
                <p className="mt-1 text-xs text-slate-400">
                  创建于 {order.createdAt.slice(0, 10)}
                  {order.startedAt ? ` · 开始于 ${order.startedAt.slice(0, 10)}` : ''}
                  {order.completedAt ? ` · 完成于 ${order.completedAt.slice(0, 10)}` : ''}
                  {order.handler ? ` · 经手人 ${order.handler}` : ''}
                  {order.note ? ` · 备注 ${order.note}` : ''}
                </p>

                {expanded ? (
                  <div className="mt-3 flex flex-col gap-3">
                    <TransferRack items={list} codeOf={codeOf} />
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[640px] border-collapse text-sm">
                        <thead>
                          <tr className="bg-slate-50 text-left text-xs text-slate-500">
                            <th className="border border-slate-200 px-2 py-1">标本编号</th>
                            <th className="border border-slate-200 px-2 py-1">原插位</th>
                            <th className="border border-slate-200 px-2 py-1">转运架位</th>
                            <th className="border border-slate-200 px-2 py-1">状态</th>
                          </tr>
                        </thead>
                        <tbody>
                          {list.map((item) => (
                            <tr key={item.id}>
                              <td className="border border-slate-200 px-2 py-1 font-mono text-xs text-field-700">
                                {codeOf(item.specimenId)}
                              </td>
                              <td className="border border-slate-200 px-2 py-1 font-mono text-xs">
                                {storageSlotText({
                                  id: '',
                                  specimenId: item.specimenId,
                                  method: '针插',
                                  cabinet: item.originalSlot.cabinet,
                                  drawer: item.originalSlot.drawer,
                                  box: item.originalSlot.box,
                                  slot: item.originalSlot.slot,
                                  storedDate: '',
                                  handler: ''
                                })}
                              </td>
                              <td className="border border-slate-200 px-2 py-1 font-mono text-xs">{item.transferSlot || '—'}</td>
                              <td className="border border-slate-200 px-2 py-1 text-xs">
                                <span
                                  className={
                                    item.status === '回迁失败'
                                      ? 'text-rose-600'
                                      : item.status === '已回迁'
                                        ? 'text-emerald-700'
                                        : item.status === '在转运架'
                                          ? 'text-amber-700'
                                          : 'text-slate-500'
                                  }
                                >
                                  {itemStatusText(item)}
                                </span>
                              </td>
                            </tr>
                          ))}
                          {list.length === 0 ? (
                            <tr>
                              <td colSpan={4} className="border border-slate-200 px-2 py-4 text-center text-slate-400">
                                本单没有标本
                              </td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}
              </article>
            )
          })
        )}
      </section>
    </div>
  )
}

/** 转运架：把本单各项的架位铺成网格，直观看到标本在熏蒸期间的临时存放位 */
function TransferRack({ items, codeOf }: { items: FumigationItem[]; codeOf: (specimenId: string) => string }): JSX.Element {
  const max = useMemo(() => {
    let m = 0
    items.forEach((item) => {
      const match = /^ZYJ-(\d+)$/.exec(item.transferSlot)
      if (match) m = Math.max(m, Number(match[1]))
    })
    return m
  }, [items])

  if (max === 0) {
    return <p className="text-xs text-slate-400">尚未开始搬运，转运架位待分配</p>
  }

  const bySlot = new Map<string, FumigationItem>()
  items.forEach((item) => {
    if (item.transferSlot) bySlot.set(item.transferSlot, item)
  })

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <h4 className="mb-2 text-xs font-medium text-slate-500">转运架（熏蒸期间临时存放）</h4>
      <div className="flex flex-wrap gap-1.5">
        {Array.from({ length: max }, (_, i) => i + 1).map((n) => {
          const slot = `ZYJ-${String(n).padStart(3, '0')}`
          const item = bySlot.get(slot)
          const code = item ? codeOf(item.specimenId) : ''
          return (
            <div
              key={slot}
              title={item ? `${slot}：${code}` : `${slot}：空`}
              className={`flex h-12 w-16 flex-col items-center justify-center rounded-md border text-[11px] leading-tight ${
                item
                  ? 'border-amber-400 bg-amber-50 text-amber-800'
                  : 'border-dashed border-slate-300 bg-white text-slate-300'
              }`}
            >
              <span className="block font-mono">{code || `T${String(n).padStart(2, '0')}`}</span>
              <span className="block">{item ? '在架' : '空位'}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
