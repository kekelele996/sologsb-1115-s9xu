import { useMemo, useState } from 'react'
import type { Specimen, TreatmentItem, TreatmentOrder } from '@/types'
import TreatmentTag from '@/components/common/TreatmentTag'
import { usePersistentStore } from '@/hooks/usePersistentStore'
import { specimenStore } from '@/stores/specimenStore'
import { storageStore } from '@/stores/storageStore'
import { treatmentStore, type BatchReturnResult } from '@/stores/treatmentStore'
import { encodeRack, originSlotText } from '@/utils/treatment'

interface OrderForm {
  cabinetsText: string
  handler: string
  note: string
  rackCount: number
  rackCapacity: number
}

const EMPTY_FORM: OrderForm = {
  cabinetsText: 'C03',
  handler: '',
  note: '',
  rackCount: 2,
  rackCapacity: 12
}

/** 熏蒸处理：开单 → 开工封闭/疏散 → 逐份回迁对账 → 解封结单 */
export default function FumigationPage(): JSX.Element {
  const orders = usePersistentStore(treatmentStore, (state) => state.orders)
  const items = usePersistentStore(treatmentStore, (state) => state.items)
  const specimens = usePersistentStore(specimenStore, (state) => state.rows)
  const storages = usePersistentStore(storageStore, (state) => state.rows)

  const [form, setForm] = useState<OrderForm>(EMPTY_FORM)
  const [selectedId, setSelectedId] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const specimenMap = useMemo(() => new Map(specimens.map((sp) => [sp.id, sp])), [specimens])
  const codeOf = (specimenId: string): string => specimenMap.get(specimenId)?.code ?? specimenId

  const selected: TreatmentOrder | null =
    orders.find((order) => order.id === selectedId) ?? orders[0] ?? null
  const selectedItems = useMemo(
    () =>
      items
        .filter((item) => item.orderId === selected?.id)
        .sort((a, b) => originSlotText(a).localeCompare(originSlotText(b))),
    [items, selected]
  )

  const countsOf = (orderId: string): { evacuated: number; blocked: number; returned: number } => {
    const list = items.filter((item) => item.orderId === orderId)
    return {
      evacuated: list.filter((item) => item.status === '已出柜').length,
      blocked: list.filter((item) => item.status === '回迁受阻').length,
      returned: list.filter((item) => item.status === '已回迁').length
    }
  }

  const createOrder = async (): Promise<void> => {
    setError('')
    setMessage('')
    const cabinets = form.cabinetsText
      .split(/[,，、\s]+/)
      .map((part) => part.trim())
      .filter(Boolean)
    const result = await treatmentStore.getState().createOrder({
      cabinets,
      handler: form.handler,
      note: form.note,
      rackCount: Number(form.rackCount),
      rackCapacity: Number(form.rackCapacity)
    })
    if (!result.ok || !result.order) {
      setError(result.error ?? '开单失败')
      return
    }
    setMessage(`已开单 ${result.order.code}（草稿），确认后点「开工封闭」整柜疏散`)
    setSelectedId(result.order.id)
    setForm(EMPTY_FORM)
  }

  const start = async (order: TreatmentOrder): Promise<void> => {
    setBusy(true)
    setError('')
    const result = await treatmentStore.getState().startOrder(order.id)
    setBusy(false)
    if (!result.ok) setError(result.error ?? '开工失败')
    else setMessage(`${order.code} 已整柜封闭，${result.evacuated} 份标本移入转运架，原插位全部预留`)
  }

  const returnOne = async (order: TreatmentOrder, item: TreatmentItem): Promise<void> => {
    setBusy(true)
    setError('')
    const outcome = await treatmentStore.getState().returnItem(order.id, item.id)
    setBusy(false)
    if (outcome.skipped) setMessage(`${codeOf(item.specimenId)} 已回迁过，本次跳过，未新增记录`)
    else if (outcome.ok) setMessage(`${codeOf(item.specimenId)} 已回迁 ${originSlotText(item)}`)
    else setError(`${codeOf(item.specimenId)} ${outcome.reason}`)
  }

  const returnBatch = async (order: TreatmentOrder): Promise<void> => {
    setBusy(true)
    setError('')
    const result: BatchReturnResult = await treatmentStore.getState().returnAll(order.id)
    setBusy(false)
    const parts = []
    if (result.returned > 0) parts.push(`成功回迁 ${result.returned} 份`)
    if (result.skipped > 0) parts.push(`已回迁跳过 ${result.skipped} 份`)
    setMessage(
      parts.length > 0
        ? `${order.code}：${parts.join('，')}，未产生重复记录`
        : `${order.code}：没有待回迁的明细`
    )
    if (result.blocked.length > 0) {
      setError(
        `${result.blocked.length} 份回迁受阻，仅这几份被拦下（仍在转运架，原插位继续预留）：` +
          result.blocked
            .map((item) => `${codeOf(item.specimenId)}（原插位 ${originSlotText(item)} 被 ${item.blockerCode} 占住）`)
            .join('、') +
          '。清空占用后对这张单再回迁一次即可，已回迁的不会重复。'
      )
    }
  }

  const finish = async (order: TreatmentOrder): Promise<void> => {
    setError('')
    const result = await treatmentStore.getState().finishOrder(order.id)
    if (!result.ok) setError(result.error ?? '结单失败')
    else setMessage(`${order.code} 全部回迁完毕，已解封结单`)
  }

  const removeDraft = async (order: TreatmentOrder): Promise<void> => {
    await treatmentStore.getState().removeDraft(order.id)
    setMessage(`草稿 ${order.code} 已删除`)
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="page-title">熏蒸处理单</h1>
        <p className="page-sub">
          处理组按处理单开工：点到的柜整柜封闭，标本移入转运架、原插位仍算预留；熏蒸期间鉴定照常、入柜暂缓；
          完工后逐份回迁对账，原插位被别人占住就只拦下这一份，可对同一张单反复回迁直到清空。
        </p>
      </header>

      <section className="panel">
        <h2 className="text-sm font-semibold text-slate-700">新开处理单</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-[1.4fr_1fr_2fr_auto_auto]">
          <div>
            <span className="field-label">熏蒸柜编号（多个用空格/逗号分隔）</span>
            <input
              className="field-input"
              value={form.cabinetsText}
              onChange={(e) => setForm((prev) => ({ ...prev, cabinetsText: e.target.value }))}
              placeholder="如 C02 C03"
            />
          </div>
          <div>
            <span className="field-label">处理人</span>
            <input
              className="field-input"
              value={form.handler}
              onChange={(e) => setForm((prev) => ({ ...prev, handler: e.target.value }))}
              placeholder="如 麦禾"
            />
          </div>
          <div>
            <span className="field-label">备注</span>
            <input
              className="field-input"
              value={form.note}
              onChange={(e) => setForm((prev) => ({ ...prev, note: e.target.value }))}
              placeholder="如 下半年例行熏蒸"
            />
          </div>
          <div>
            <span className="field-label">转运架数</span>
            <input
              type="number"
              min={1}
              className="field-input w-24"
              value={form.rackCount}
              onChange={(e) => setForm((prev) => ({ ...prev, rackCount: Math.max(1, Number(e.target.value) || 1) }))}
            />
          </div>
          <div>
            <span className="field-label">每架层位</span>
            <input
              type="number"
              min={1}
              className="field-input w-24"
              value={form.rackCapacity}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, rackCapacity: Math.max(1, Number(e.target.value) || 1) }))
              }
            />
          </div>
        </div>
        <button className="btn-primary mt-3" type="button" onClick={() => void createOrder()}>
          登记处理单（草稿）
        </button>
      </section>

      {error ? (
        <p className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>
      ) : null}
      {message ? (
        <p className="rounded-lg border border-field-100 bg-field-50 px-3 py-2 text-sm text-field-700">{message}</p>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <div className="panel flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-slate-700">处理单（{orders.length}）</h2>
          <div className="max-h-[520px] overflow-auto">
            {orders.map((order) => {
              const counts = countsOf(order.id)
              return (
                <button
                  key={order.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(order.id)
                    setError('')
                    setMessage('')
                  }}
                  className={`mb-1.5 w-full rounded-lg border px-3 py-2 text-left transition ${
                    selected?.id === order.id ? 'border-field-500 bg-field-50' : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-field-700">{order.code}</span>
                    <TreatmentTag status={order.status} />
                  </span>
                  <span className="mt-0.5 block text-xs text-slate-600">柜 {order.cabinets.join('、')}</span>
                  <span className="block text-[11px] text-slate-400">
                    {order.status === '草稿'
                      ? '尚未开工'
                      : `出柜 ${counts.evacuated + counts.blocked + counts.returned} · 受阻 ${counts.blocked} · 已回迁 ${counts.returned}`}
                  </span>
                </button>
              )
            })}
            {orders.length === 0 ? <p className="text-sm text-slate-400">还没有处理单，先在上面开一张</p> : null}
          </div>
        </div>

        {selected ? <OrderDetail
          order={selected}
          items={selectedItems}
          storages={storages}
          specimens={specimens}
          busy={busy}
          onStart={() => void start(selected)}
          onReturnOne={(item) => void returnOne(selected, item)}
          onReturnAll={() => void returnBatch(selected)}
          onFinish={() => void finish(selected)}
          onRemoveDraft={() => void removeDraft(selected)}
        /> : (
          <div className="panel text-sm text-slate-400">请选择左侧一张处理单</div>
        )}
      </section>
    </div>
  )
}

interface OrderDetailProps {
  order: TreatmentOrder
  items: TreatmentItem[]
  storages: ReturnType<typeof storageStore.getState>['rows']
  specimens: Specimen[]
  busy: boolean
  onStart: () => void
  onReturnOne: (item: TreatmentItem) => void
  onReturnAll: () => void
  onFinish: () => void
  onRemoveDraft: () => void
}

function OrderDetail({
  order,
  items,
  storages,
  specimens,
  busy,
  onStart,
  onReturnOne,
  onReturnAll,
  onFinish,
  onRemoveDraft
}: OrderDetailProps): JSX.Element {
  const codeOf = (specimenId: string): string =>
    specimens.find((sp) => sp.id === specimenId)?.code ?? specimenId

  return (
    <div className="flex flex-col gap-4">
      <div className="panel">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-mono text-base font-semibold text-slate-800">{order.code}</h2>
          <TreatmentTag status={order.status} />
        </div>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600 md:grid-cols-4">
          <div>
            <dt className="text-slate-400">封闭柜</dt>
            <dd className="font-mono">{order.cabinets.join('、')}</dd>
          </div>
          <div>
            <dt className="text-slate-400">处理人</dt>
            <dd>{order.handler || '—'}</dd>
          </div>
          <div>
            <dt className="text-slate-400">开单日期</dt>
            <dd>{order.createdDate || '—'}</dd>
          </div>
          <div>
            <dt className="text-slate-400">转运架</dt>
            <dd>
              {order.rackCount} 架 × {order.rackCapacity} 位
            </dd>
          </div>
          <div>
            <dt className="text-slate-400">开工时间</dt>
            <dd>{order.startedAt ? new Date(order.startedAt).toLocaleString('zh-CN') : '—'}</dd>
          </div>
          <div>
            <dt className="text-slate-400">完成时间</dt>
            <dd>{order.finishedAt ? new Date(order.finishedAt).toLocaleString('zh-CN') : '—'}</dd>
          </div>
        </dl>
        {order.note ? <p className="mt-2 rounded-lg bg-slate-50 px-3 py-1.5 text-xs text-slate-500">备注：{order.note}</p> : null}

        <div className="mt-3 flex flex-wrap gap-2">
          {order.status === '草稿' ? (
            <>
              <button className="btn-primary" type="button" disabled={busy} onClick={onStart}>
                开工封闭（整柜疏散）
              </button>
              <button className="btn-danger" type="button" disabled={busy} onClick={onRemoveDraft}>
                删除草稿
              </button>
            </>
          ) : null}
          {order.status === '熏蒸中' ? (
            <>
              <button className="btn-primary" type="button" disabled={busy} onClick={onReturnAll}>
                按本单批量回迁
              </button>
              <button className="btn-ghost" type="button" disabled={busy} onClick={onFinish}>
                全部回迁后解封结单
              </button>
            </>
          ) : null}
          {order.status === '已完成' ? (
            <span className="text-xs text-slate-500">本单已解封，全部标本已回到原插位</span>
          ) : null}
        </div>
        {order.status === '熏蒸中' ? (
          <p className="mt-2 text-[11px] text-slate-400">
            提示：批量回迁可反复执行，已回迁的自动跳过，不会多出记录或重复占位；受阻份在保藏柜位图把占住者出柜后再跑一次即可。
          </p>
        ) : null}
      </div>

      <div className="panel">
        <h3 className="text-sm font-semibold text-slate-700">
          处理明细（{items.length}）
          {order.status === '熏蒸中'
            ? ` · 已出柜 ${items.filter((i) => i.status === '已出柜').length} · 受阻 ${
                items.filter((i) => i.status === '回迁受阻').length
              } · 已回迁 ${items.filter((i) => i.status === '已回迁').length}`
            : ''}
        </h3>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 text-left text-slate-500">
                <th className="border border-slate-200 px-2 py-1">标本编号</th>
                <th className="border border-slate-200 px-2 py-1">原插位（预留）</th>
                <th className="border border-slate-200 px-2 py-1">转运架位</th>
                <th className="border border-slate-200 px-2 py-1">馆藏当前柜位</th>
                <th className="border border-slate-200 px-2 py-1">处理状态</th>
                <th className="border border-slate-200 px-2 py-1">结果</th>
                <th className="border border-slate-200 px-2 py-1">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const current = storages.find((storage) => storage.specimenId === item.specimenId)
                const drifted =
                  current !== undefined &&
                  [current.cabinet, current.drawer, current.box, current.slot].join() !==
                    [item.origin.cabinet, item.origin.drawer, item.origin.box, item.origin.slot].join()
                return (
                  <tr key={item.id}>
                    <td className="border border-slate-200 px-2 py-1 font-mono">{codeOf(item.specimenId)}</td>
                    <td className="border border-slate-200 px-2 py-1 font-mono">{originSlotText(item)}</td>
                    <td className="border border-slate-200 px-2 py-1 font-mono">{encodeRack(item.rack, item.rackSlot)}</td>
                    <td className="border border-slate-200 px-2 py-1 font-mono">
                      {current ? (
                        <>
                          {current.cabinet}-D{current.drawer}-B{String(current.box).padStart(2, '0')}-S
                          {String(current.slot).padStart(2, '0')}
                          {drifted ? <span className="ml-1 text-amber-600">台账有漂移</span> : null}
                        </>
                      ) : (
                        <span className="text-slate-400">馆藏无在柜记录</span>
                      )}
                    </td>
                    <td className="border border-slate-200 px-2 py-1">
                      <TreatmentTag status={item.status} />
                    </td>
                    <td className="border border-slate-200 px-2 py-1 text-slate-500">{item.lastResult || '—'}</td>
                    <td className="border border-slate-200 px-2 py-1">
                      {order.status === '熏蒸中' && item.status !== '已回迁' ? (
                        <button className="btn-ghost" type="button" disabled={busy} onClick={() => onReturnOne(item)}>
                          回迁这一份
                        </button>
                      ) : item.status === '已回迁' ? (
                        <span className="text-slate-400">已回迁</span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                )
              })}
              {items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="border border-slate-200 px-2 py-4 text-center text-slate-400">
                    {order.status === '草稿'
                      ? '草稿还没有明细，点「开工封闭」后会按馆藏台账逐份生成'
                      : '本单没有处理明细'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
