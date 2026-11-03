import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { formatINR, formatDate, formatWeight, getDaysLeft } from '../lib/utils'
import { getSellingRecords, deleteSellingRecord, markSellingAsPaid, markSellingAsUnpaid } from '../lib/sellingService'
import SellingForm from '../components/SellingForm'
import DoubleConfirm from '../components/DoubleConfirm'

export default function SellingPortal({ onNavigate }) {
  const [sellings, setSellings] = useState([])
  const [parties, setParties] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterParty, setFilterParty] = useState('')
  const [filterTab, setFilterTab] = useState('ALL') // ALL | UNPAID | PAID | OVERDUE | DUE_SOON
  const [showForm, setShowForm] = useState(false)
  const [editSelling, setEditSelling] = useState(null)
  const [deleteSelling, setDeleteSelling] = useState(null)
  const [deleting, setDeleting] = useState(false)

  // Mark as Paid dialog state
  const [markPaidTarget, setMarkPaidTarget] = useState(null)
  const [selectedPayType, setSelectedPayType] = useState('collected') // 'collected' | 'adjusted'
  const [markingPaid, setMarkingPaid] = useState(false)

  // Mark as Unpaid confirm dialog state
  const [unmarkTarget, setUnmarkTarget] = useState(null)
  const [unmarking, setUnmarking] = useState(false)

  // Expanded row id for viewing multi-lot lines
  const [expandedId, setExpandedId] = useState(null)

  const [sortCol, setSortCol] = useState('selling_date')
  const [sortDir, setSortDir] = useState('desc')

  const today = new Date().toISOString().split('T')[0]

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    try {
      const [records, { data: par }] = await Promise.all([
        getSellingRecords(),
        supabase.from('parties').select('id, name').eq('is_active', true).order('name')
      ])
      setSellings(records || [])
      setParties(par || [])
    } catch (err) {
      console.error('Error loading selling portal:', err)
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete() {
    if (!deleteSelling) return
    setDeleting(true)
    try {
      await deleteSellingRecord(deleteSelling)
      setDeleteSelling(null)
      load()
    } catch (err) {
      console.error('Failed to delete selling:', err)
      alert('Failed to delete: ' + err.message)
    } finally {
      setDeleting(false)
    }
  }

  async function handleConfirmPaid() {
    if (!markPaidTarget) return
    setMarkingPaid(true)
    try {
      await markSellingAsPaid(markPaidTarget, selectedPayType)
      setMarkPaidTarget(null)
      load()
    } catch (err) {
      console.error('Error marking as paid:', err)
      alert('Failed to mark as paid: ' + err.message)
    } finally {
      setMarkingPaid(false)
    }
  }

  async function handleConfirmUnpaid() {
    if (!unmarkTarget) return
    setUnmarking(true)
    try {
      await markSellingAsUnpaid(unmarkTarget)
      setUnmarkTarget(null)
      load()
    } catch (err) {
      console.error('Error unmarking paid:', err)
      alert('Failed to unmark: ' + err.message)
    } finally {
      setUnmarking(false)
    }
  }

  function handleSwitchClick(item) {
    if (item.payment_status === 'paid') {
      // Prompt to unmark as paid
      setUnmarkTarget(item)
    } else {
      // Prompt to choose Collect or Adjust
      setSelectedPayType('collected')
      setMarkPaidTarget(item)
    }
  }

  function toggleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  // Calculate statistics across all selling records
  const totalAmountAll = sellings.reduce((s, x) => s + (Number(x.total_amount) || 0), 0)
  const totalWeightAll = sellings.reduce((s, x) => s + (Number(x.quantity) || 0), 0)
  const paidItems = sellings.filter(x => x.payment_status === 'paid')
  const unpaidItems = sellings.filter(x => x.payment_status !== 'paid')
  const adjustedTotalAll = paidItems.filter(x => x.payment_type === 'adjusted').reduce((s, x) => s + (Number(x.total_amount) || 0), 0)
  const collectedTotalAll = paidItems.filter(x => x.payment_type === 'collected').reduce((s, x) => s + (Number(x.total_amount) || 0), 0)

  // Overdue & due soon
  const overdueItems = sellings.filter(x => {
    const d = getDaysLeft(x.due_date, today)
    return d.status === 'overdue' && x.payment_status !== 'paid'
  })
  const dueSoonItems = sellings.filter(x => {
    const d = getDaysLeft(x.due_date, today)
    return (d.status === 'due_soon' || d.status === 'today') && x.payment_status !== 'paid'
  })

  // Filter and sort items
  const filtered = sellings
    .filter(item => {
      const s = search.toLowerCase()
      const matchSearch = !search ||
        item.title?.toLowerCase().includes(s) ||
        item.supplier_name?.toLowerCase().includes(s) ||
        item.remarks?.toLowerCase().includes(s) ||
        item.lines?.some(l => l.description?.toLowerCase().includes(s))

      const matchParty = !filterParty || item.supplier_id === filterParty

      let matchTab = true
      const d = getDaysLeft(item.due_date, today)
      if (filterTab === 'UNPAID') matchTab = (item.payment_status !== 'paid')
      else if (filterTab === 'PAID') matchTab = (item.payment_status === 'paid')
      else if (filterTab === 'OVERDUE') matchTab = (d.status === 'overdue' && item.payment_status !== 'paid')
      else if (filterTab === 'DUE_SOON') matchTab = ((d.status === 'due_soon' || d.status === 'today') && item.payment_status !== 'paid')

      return matchSearch && matchParty && matchTab
    })
    .sort((a, b) => {
      let va = a[sortCol], vb = b[sortCol]
      if (sortCol === 'days_left') {
        const da = getDaysLeft(a.due_date, today).days ?? 9999
        const db = getDaysLeft(b.due_date, today).days ?? 9999
        return sortDir === 'asc' ? da - db : db - da
      }
      if (typeof va === 'string') va = va.toLowerCase()
      if (typeof vb === 'string') vb = vb.toLowerCase()
      return sortDir === 'asc' ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1)
    })

  const filteredTotal = filtered.reduce((s, x) => s + (Number(x.total_amount) || 0), 0)
  const filteredWeight = filtered.reduce((s, x) => s + (Number(x.quantity) || 0), 0)

  if (loading) {
    return (
      <div className="spinner-wrap">
        <div className="spinner" />
        Loading Selling Portal…
      </div>
    )
  }

  return (
    <div>
      {/* Page Header */}
      <div className="page-header">
        <div className="flex items-center justify-between">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 24 }}>💎</span>
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)' }}>
                Selling Portal
              </h1>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                {sellings.length} sales · {formatWeight(totalWeightAll)} · {formatINR(totalAmountAll)} turnover
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <button className="btn btn-ghost btn-sm" onClick={load}>🔄 Refresh</button>
            <button
              className="btn btn-primary"
              onClick={() => { setEditSelling(null); setShowForm(true) }}
              style={{ fontWeight: 700 }}
            >
              + Add Selling
            </button>
          </div>
        </div>
      </div>

      <div className="page-body">
        {/* KPI Cards */}
        <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', marginBottom: 20 }}>
          <div className="kpi-card">
            <div className="kpi-icon">💰</div>
            <div className="kpi-label">Total Turnover</div>
            <div className="kpi-value" style={{ color: 'var(--accent)' }}>{formatINR(totalAmountAll)}</div>
            <div className="kpi-sub">{sellings.length} total sales ({formatWeight(totalWeightAll)})</div>
          </div>

          <div className="kpi-card">
            <div className="kpi-icon">⏳</div>
            <div className="kpi-label">Pending / Unpaid</div>
            <div className="kpi-value" style={{ color: unpaidItems.length > 0 ? 'var(--yellow)' : 'var(--text-muted)' }}>
              {unpaidItems.length}
            </div>
            <div className="kpi-sub">
              {formatINR(unpaidItems.reduce((s, x) => s + Number(x.total_amount || 0), 0))} pending
            </div>
          </div>

          <div className="kpi-card">
            <div className="kpi-icon">🤝</div>
            <div className="kpi-label">Adjusted to Balance</div>
            <div className="kpi-value" style={{ color: 'var(--green)' }}>{formatINR(adjustedTotalAll)}</div>
            <div className="kpi-sub">
              {paidItems.filter(x => x.payment_type === 'adjusted').length} sales settled in supplier ledger
            </div>
          </div>

          <div className="kpi-card">
            <div className="kpi-icon">💵</div>
            <div className="kpi-label">Collected Amount</div>
            <div className="kpi-value" style={{ color: 'var(--blue)' }}>{formatINR(collectedTotalAll)}</div>
            <div className="kpi-sub">
              {paidItems.filter(x => x.payment_type === 'collected').length} sales collected directly
            </div>
          </div>

          <div className="kpi-card">
            <div className="kpi-icon">🚨</div>
            <div className="kpi-label">Overdue Sales</div>
            <div className="kpi-value" style={{ color: overdueItems.length > 0 ? 'var(--red)' : 'var(--text-muted)' }}>
              {overdueItems.length}
            </div>
            <div className="kpi-sub">
              {overdueItems.length > 0 ? formatINR(overdueItems.reduce((s, x) => s + Number(x.total_amount || 0), 0)) : 'All within due dates'}
            </div>
          </div>
        </div>

        {/* Filters and Search Bar */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
          <div className="search-box" style={{ flex: '1 1 240px', minWidth: 220 }}>
            <span className="search-icon">🔍</span>
            <input
              className="input"
              placeholder="Search title, supplier, remarks, items…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <select
            className="select"
            style={{ width: 220 }}
            value={filterParty}
            onChange={e => setFilterParty(e.target.value)}
          >
            <option value="">All Suppliers ({parties.length})</option>
            {parties.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>

          {/* Filter tabs */}
          <div className="tabs" style={{ overflowX: 'auto', flexWrap: 'nowrap' }}>
            <button
              className={`tab ${filterTab === 'ALL' ? 'active' : ''}`}
              onClick={() => setFilterTab('ALL')}
            >
              All ({sellings.length})
            </button>
            <button
              className={`tab ${filterTab === 'UNPAID' ? 'active' : ''}`}
              onClick={() => setFilterTab('UNPAID')}
              style={{ color: unpaidItems.length > 0 && filterTab !== 'UNPAID' ? 'var(--yellow)' : undefined }}
            >
              ⏳ Unpaid ({unpaidItems.length})
            </button>
            <button
              className={`tab ${filterTab === 'PAID' ? 'active' : ''}`}
              onClick={() => setFilterTab('PAID')}
              style={{ color: paidItems.length > 0 && filterTab !== 'PAID' ? 'var(--green)' : undefined }}
            >
              ✅ Paid ({paidItems.length})
            </button>
            <button
              className={`tab ${filterTab === 'OVERDUE' ? 'active' : ''}`}
              onClick={() => setFilterTab('OVERDUE')}
              style={{ color: overdueItems.length > 0 && filterTab !== 'OVERDUE' ? 'var(--red)' : undefined }}
            >
              🔴 Overdue ({overdueItems.length})
            </button>
            <button
              className={`tab ${filterTab === 'DUE_SOON' ? 'active' : ''}`}
              onClick={() => setFilterTab('DUE_SOON')}
            >
              ⚠️ Due Soon ({dueSoonItems.length})
            </button>
          </div>
        </div>

        {/* Filtered Summary Header */}
        {(search || filterParty || filterTab !== 'ALL') && (
          <div style={{ display: 'flex', gap: 14, marginBottom: 14, alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Filtered: <strong>{filtered.length}</strong> sales totaling <strong>{formatINR(filteredTotal)}</strong> ({formatWeight(filteredWeight)})
            </span>
            <button
              className="btn btn-ghost btn-sm"
              style={{ padding: '2px 8px', fontSize: 11 }}
              onClick={() => { setSearch(''); setFilterParty(''); setFilterTab('ALL') }}
            >
              Clear filters
            </button>
          </div>
        )}

        {/* Selling Records Register Table */}
        <div className="table-wrapper">
          <div className="table-header">
            <div className="table-title">Selling Records Register</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {filtered.length} of {sellings.length} shown
            </div>
          </div>

          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th onClick={() => toggleSort('title')}>
                    Title / Lot {sortCol === 'title' ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                  </th>
                  <th onClick={() => toggleSort('supplier_name')}>
                    Supplier {sortCol === 'supplier_name' ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                  </th>
                  <th onClick={() => toggleSort('selling_date')}>
                    Date {sortCol === 'selling_date' ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                  </th>
                  <th className="td-right" onClick={() => toggleSort('quantity')}>
                    Items / Weight (ct) {sortCol === 'quantity' ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                  </th>
                  <th className="td-right" onClick={() => toggleSort('total_amount')}>
                    Total Amount {sortCol === 'total_amount' ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                  </th>
                  <th onClick={() => toggleSort('due_date')}>
                    Due Date {sortCol === 'due_date' ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                  </th>
                  <th onClick={() => toggleSort('days_left')}>
                    Days Left {sortCol === 'days_left' ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                  </th>
                  <th style={{ textAlign: 'center' }}>Mark as Paid Switch</th>
                  <th style={{ textAlign: 'center', width: 90 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={9}>
                      <div className="empty-state">
                        <div className="empty-icon">💎</div>
                        <p style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>No selling records found</p>
                        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
                          {search || filterParty || filterTab !== 'ALL'
                            ? 'No records match your filters. Try clearing filters.'
                            : 'Click "+ Add Selling" above to record your first diamond sale.'}
                        </p>
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => { setEditSelling(null); setShowForm(true) }}
                        >
                          + Add Selling
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filtered.map(item => {
                    const daysInfo = getDaysLeft(item.due_date, today)
                    const isPaid = item.payment_status === 'paid'
                    const isAdjusted = item.payment_type === 'adjusted'
                    const linesCount = item.lines?.length || 1
                    const isExpanded = expandedId === item.id

                    return (
                      <>
                        <tr key={item.id} style={{ background: isExpanded ? 'var(--bg-card-hover)' : undefined }}>
                          {/* Title */}
                          <td className="td-primary">
                            <div style={{ fontWeight: 700, fontSize: 14 }}>{item.title}</div>
                            {item.remarks && (
                              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.remarks}>
                                {item.remarks}
                              </div>
                            )}
                          </td>

                          {/* Supplier */}
                          <td>
                            <div
                              style={{ fontWeight: 600, cursor: onNavigate ? 'pointer' : 'default', color: onNavigate ? 'var(--accent)' : 'inherit' }}
                              onClick={() => onNavigate && onNavigate('parties')}
                              title={onNavigate ? "Click to view in Suppliers" : undefined}
                            >
                              {item.supplier_name}
                            </div>
                            {item.supplier_balance > 0 && (
                              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                Bal: {formatINR(item.supplier_balance)}
                              </div>
                            )}
                          </td>

                          {/* Selling Date */}
                          <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                            {formatDate(item.selling_date)}
                          </td>

                          {/* Items / Quantity */}
                          <td className="td-right">
                            <div className="td-mono" style={{ fontWeight: 700, fontSize: 14 }}>
                              {formatWeight(item.quantity)}
                            </div>
                            {linesCount > 1 ? (
                              <button
                                type="button"
                                onClick={() => setExpandedId(isExpanded ? null : item.id)}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  color: 'var(--accent)',
                                  fontSize: 11,
                                  cursor: 'pointer',
                                  padding: 0,
                                  marginTop: 2,
                                  textDecoration: 'underline'
                                }}
                              >
                                {isExpanded ? '▲ Hide items' : `▼ ${linesCount} items`}
                              </button>
                            ) : (
                              item.lines?.[0]?.carat_rate > 0 && (
                                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                                  ₹{Number(item.lines[0].carat_rate).toLocaleString('en-IN')}/ct
                                </div>
                              )
                            )}
                          </td>

                          {/* Total Amount */}
                          <td className="td-right td-mono">
                            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--green-light)' }}>
                              {formatINR(item.total_amount)}
                            </div>
                            {item.additional_charge > 0 && (
                              <div style={{
                                fontSize: 11,
                                fontWeight: 600,
                                color: item.additional_charge_type === 'deduct' ? 'var(--red)' : 'var(--blue)',
                                marginTop: 2
                              }}>
                                {item.additional_charge_type === 'deduct' ? '-' : '+'} {formatINR(item.additional_charge)}
                                {item.additional_charge_label ? ` (${item.additional_charge_label})` : ''}
                              </div>
                            )}
                          </td>

                          {/* Due Date */}
                          <td style={{ fontSize: 13, fontWeight: 500 }}>
                            {formatDate(item.due_date)}
                          </td>

                          {/* Days Left badge */}
                          <td>
                            <span
                              className={`badge ${daysInfo.badgeClass}`}
                              style={{
                                fontSize: 11.5,
                                padding: '3px 8px',
                                fontWeight: 700,
                              }}
                            >
                              {daysInfo.icon} {daysInfo.text}
                            </span>
                          </td>

                          {/* Mark as Paid Switch */}
                          <td style={{ textAlign: 'center' }}>
                            <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                              <button
                                type="button"
                                onClick={() => handleSwitchClick(item)}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 6,
                                  padding: '5px 12px',
                                  borderRadius: 20,
                                  cursor: 'pointer',
                                  fontWeight: 700,
                                  fontSize: 12,
                                  transition: 'all 0.15s ease',
                                  border: isPaid
                                    ? (isAdjusted ? '1.5px solid var(--green-border)' : '1.5px solid var(--blue-border)')
                                    : '1.5px solid var(--border)',
                                  background: isPaid
                                    ? (isAdjusted ? 'var(--green-bg)' : 'var(--blue-bg)')
                                    : 'var(--bg-elevated)',
                                  color: isPaid
                                    ? (isAdjusted ? 'var(--green-light)' : 'var(--accent)')
                                    : 'var(--text-muted)',
                                }}
                                title={isPaid ? "Click to Mark as Unpaid" : "Click to Mark as Paid"}
                              >
                                <span>{isPaid ? (isAdjusted ? '⚖️' : '💵') : '⚪'}</span>
                                <span>
                                  {isPaid
                                    ? (isAdjusted ? 'Paid (Adjusted)' : 'Paid (Collected)')
                                    : 'Mark as Paid'}
                                </span>
                                {isPaid && (
                                  <span style={{
                                    fontSize: 10,
                                    background: isAdjusted ? 'var(--green)' : 'var(--accent)',
                                    color: 'white',
                                    borderRadius: '50%',
                                    width: 14,
                                    height: 14,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center'
                                  }}>
                                    ✓
                                  </span>
                                )}
                              </button>

                              {isPaid && isAdjusted && (
                                <div
                                  style={{ fontSize: 10, color: 'var(--green)', cursor: onNavigate ? 'pointer' : 'default' }}
                                  onClick={() => onNavigate && onNavigate('payments')}
                                  title="View in Payments register"
                                >
                                  Entered in ledger ↗
                                </div>
                              )}
                            </div>
                          </td>

                          {/* Actions */}
                          <td>
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                              {/* Edit */}
                              <button
                                title="Edit Selling"
                                onClick={() => { setEditSelling(item); setShowForm(true) }}
                                style={{
                                  background: 'none',
                                  border: '1px solid var(--border)',
                                  borderRadius: 6,
                                  cursor: 'pointer',
                                  width: 30,
                                  height: 30,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: 14,
                                }}
                                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'none'}
                              >
                                ✏️
                              </button>

                              {/* Delete */}
                              <button
                                title="Delete Selling"
                                onClick={() => setDeleteSelling(item)}
                                style={{
                                  background: 'none',
                                  border: '1px solid var(--red-border)',
                                  borderRadius: 6,
                                  cursor: 'pointer',
                                  width: 30,
                                  height: 30,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: 14,
                                  color: 'var(--red)',
                                }}
                                onMouseEnter={e => e.currentTarget.style.background = 'var(--red-bg)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'none'}
                              >
                                🗑️
                              </button>
                            </div>
                          </td>
                        </tr>

                        {/* Expanded Multiple Quantities Lot Breakdown */}
                        {isExpanded && item.lines && (
                          <tr style={{ background: 'var(--bg-elevated)' }}>
                            <td colSpan={9} style={{ padding: '12px 24px' }}>
                              <div style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 12 }}>
                                <div style={{ fontWeight: 700, fontSize: 12, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>
                                  Lot Breakdown for "{item.title}" ({item.lines.length} items)
                                </div>
                                <table style={{ width: '100%', fontSize: 12.5, borderCollapse: 'collapse' }}>
                                  <thead>
                                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                                      <th style={{ padding: '6px 8px' }}>#</th>
                                      <th style={{ padding: '6px 8px' }}>Description</th>
                                      <th className="td-right" style={{ padding: '6px 8px' }}>Weight (ct)</th>
                                      <th className="td-right" style={{ padding: '6px 8px' }}>Rate (₹/ct)</th>
                                      <th className="td-right" style={{ padding: '6px 8px' }}>Amount (₹)</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {item.lines.map((l, i) => (
                                      <tr key={i} style={{ borderBottom: i < item.lines.length - 1 ? '1px solid var(--bg-elevated)' : 'none' }}>
                                        <td style={{ padding: '6px 8px', color: 'var(--text-muted)' }}>{i + 1}</td>
                                        <td style={{ padding: '6px 8px', fontWeight: 600 }}>{l.description || `Lot item #${i + 1}`}</td>
                                        <td className="td-right td-mono" style={{ padding: '6px 8px' }}>{formatWeight(l.quantity)}</td>
                                        <td className="td-right td-mono" style={{ padding: '6px 8px' }}>₹{Number(l.carat_rate).toLocaleString('en-IN')}</td>
                                        <td className="td-right td-mono" style={{ padding: '6px 8px', fontWeight: 700, color: 'var(--green-light)' }}>{formatINR(l.amount)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                  <tfoot>
                                    <tr style={{ borderTop: '1.5px solid var(--border)', background: 'var(--bg-card)' }}>
                                      <td colSpan={2} style={{ padding: '8px 10px', fontWeight: 700, textAlign: 'right' }}>
                                        Items Subtotal:
                                      </td>
                                      <td className="td-right td-mono" style={{ padding: '8px 10px', fontWeight: 700 }}>
                                        {formatWeight(item.quantity)}
                                      </td>
                                      <td></td>
                                      <td className="td-right td-mono" style={{ padding: '8px 10px', fontWeight: 700 }}>
                                        {formatINR(item.subtotal_amount || item.total_amount)}
                                      </td>
                                    </tr>
                                    {item.additional_charge > 0 && (
                                      <tr style={{ background: 'var(--bg-card)' }}>
                                        <td colSpan={4} style={{ padding: '6px 10px', fontWeight: 600, textAlign: 'right', color: item.additional_charge_type === 'deduct' ? 'var(--red)' : 'var(--blue)' }}>
                                          {item.additional_charge_type === 'deduct' ? '➖ Deduction' : '➕ Additional Charge'} {item.additional_charge_label ? `(${item.additional_charge_label})` : ''}:
                                        </td>
                                        <td className="td-right td-mono" style={{ padding: '6px 10px', fontWeight: 700, color: item.additional_charge_type === 'deduct' ? 'var(--red)' : 'var(--blue)' }}>
                                          {item.additional_charge_type === 'deduct' ? '-' : '+'} {formatINR(item.additional_charge)}
                                        </td>
                                      </tr>
                                    )}
                                    <tr style={{ borderTop: '1px solid var(--border)', background: 'var(--blue-bg)' }}>
                                      <td colSpan={4} style={{ padding: '8px 10px', fontWeight: 800, textAlign: 'right', color: 'var(--accent)' }}>
                                        Final Total Amount:
                                      </td>
                                      <td className="td-right td-mono" style={{ padding: '8px 10px', fontWeight: 900, fontSize: 14, color: 'var(--accent)' }}>
                                        {formatINR(item.total_amount)}
                                      </td>
                                    </tr>
                                  </tfoot>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Add / Edit Selling Form Modal */}
      {showForm && (
        <SellingForm
          selling={editSelling}
          onClose={() => { setShowForm(false); setEditSelling(null) }}
          onSaved={() => {
            setShowForm(false)
            setEditSelling(null)
            load()
          }}
        />
      )}

      {/* Mark as Paid Modal (Asks Collect or Adjust) */}
      {markPaidTarget && (
        <div className="modal-backdrop" onClick={() => setMarkPaidTarget(null)}>
          <div className="modal" style={{ maxWidth: 500 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>✅ Mark Sale as Paid</span>
              </div>
              <button className="modal-close" onClick={() => setMarkPaidTarget(null)}>✕</button>
            </div>

            {/* Sale summary */}
            <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '14px 16px', marginBottom: 20 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>
                {markPaidTarget.title}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
                Supplier: <strong>{markPaidTarget.supplier_name}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingTop: 10, borderTop: '1px dashed var(--border)' }}>
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  Total {formatWeight(markPaidTarget.quantity)}:
                </span>
                <span style={{ fontSize: 20, fontWeight: 900, color: 'var(--green)', fontFamily: 'JetBrains Mono, monospace' }}>
                  {formatINR(markPaidTarget.total_amount)}
                </span>
              </div>
            </div>

            <div style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-secondary)', marginBottom: 10 }}>
              Select Payment Settlement:
            </div>

            {/* Two choice cards: Collect or Adjust */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
              {/* Option 1: Collected */}
              <div
                onClick={() => setSelectedPayType('collected')}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  padding: '14px 16px',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  border: selectedPayType === 'collected' ? '2px solid var(--accent)' : '1px solid var(--border)',
                  background: selectedPayType === 'collected' ? 'var(--blue-bg)' : 'white',
                  transition: 'all 0.15s ease'
                }}
              >
                <div style={{ fontSize: 22, marginTop: 2 }}>💵</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 800, fontSize: 14, color: selectedPayType === 'collected' ? 'var(--accent)' : 'var(--text-primary)' }}>
                    Collected Amount
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.4 }}>
                    Cash / Bank payment received directly from customer. Supplier ledger and balance remain unchanged.
                  </div>
                </div>
                <input
                  type="radio"
                  name="payType"
                  checked={selectedPayType === 'collected'}
                  onChange={() => setSelectedPayType('collected')}
                  style={{ marginTop: 4 }}
                />
              </div>

              {/* Option 2: Adjust */}
              <div
                onClick={() => setSelectedPayType('adjusted')}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  padding: '14px 16px',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  border: selectedPayType === 'adjusted' ? '2px solid var(--green)' : '1px solid var(--border)',
                  background: selectedPayType === 'adjusted' ? 'var(--green-bg)' : 'white',
                  transition: 'all 0.15s ease'
                }}
              >
                <div style={{ fontSize: 22, marginTop: 2 }}>⚖️</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 800, fontSize: 14, color: selectedPayType === 'adjusted' ? 'var(--green-light)' : 'var(--text-primary)' }}>
                    Adjust to Supplier Balance
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.4 }}>
                    Enter a payment transaction of <strong>{formatINR(markPaidTarget.total_amount)}</strong> to <strong>{markPaidTarget.supplier_name}</strong> to settle open purchase bills via FIFO.
                  </div>
                </div>
                <input
                  type="radio"
                  name="payType"
                  checked={selectedPayType === 'adjusted'}
                  onChange={() => setSelectedPayType('adjusted')}
                  style={{ marginTop: 4 }}
                />
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setMarkPaidTarget(null)}
                disabled={markingPaid}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn"
                style={{
                  background: selectedPayType === 'adjusted' ? 'var(--green)' : 'var(--accent)',
                  color: 'white',
                  border: 'none',
                  fontWeight: 700,
                  minWidth: 150
                }}
                onClick={handleConfirmPaid}
                disabled={markingPaid}
              >
                {markingPaid ? 'Processing…' : (selectedPayType === 'adjusted' ? '⚖️ Confirm & Adjust' : '💵 Confirm as Collected')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unmark Paid Confirmation Dialog */}
      {unmarkTarget && (
        <div className="modal-backdrop" onClick={() => setUnmarkTarget(null)}>
          <div className="modal" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title" style={{ color: 'var(--yellow-light)' }}>
                ⚠️ Mark as Unpaid?
              </div>
              <button className="modal-close" onClick={() => setUnmarkTarget(null)}>✕</button>
            </div>

            <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              Are you sure you want to mark <strong>"{unmarkTarget.title}"</strong> ({formatINR(unmarkTarget.total_amount)}) as <strong>Unpaid</strong>?
            </div>

            {unmarkTarget.payment_type === 'adjusted' && (
              <div style={{ marginTop: 14, padding: '10px 14px', background: 'var(--red-bg)', border: '1.5px solid var(--red-border)', borderRadius: 'var(--radius-md)', fontSize: 13, color: 'var(--red)', lineHeight: 1.4 }}>
                ⚠️ <strong>Ledger Impact</strong>: This sale was adjusted against <strong>{unmarkTarget.supplier_name}</strong>. Marking it as unpaid will remove the ₹{Number(unmarkTarget.total_amount).toLocaleString('en-IN')} payment transaction from their account ledger!
              </div>
            )}

            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setUnmarkTarget(null)} disabled={unmarking}>
                Cancel
              </button>
              <button
                className="btn"
                style={{ background: 'var(--yellow)', color: 'white', border: 'none', fontWeight: 700 }}
                onClick={handleConfirmUnpaid}
                disabled={unmarking}
              >
                {unmarking ? 'Updating…' : 'Yes, Mark as Unpaid'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteSelling && (
        <DoubleConfirm
          title="Delete Selling Record"
          body={
            <div>
              Are you sure you want to delete <strong>"{deleteSelling.title}"</strong> ({formatINR(deleteSelling.total_amount)})?
              {deleteSelling.payment_type === 'adjusted' && (
                <div style={{ marginTop: 10, padding: '8px 12px', background: 'var(--yellow-bg)', border: '1px solid var(--yellow-border)', borderRadius: 6, fontSize: 13, color: 'var(--yellow-light)' }}>
                  ⚠️ This selling was <strong>Adjusted to Balance</strong>. Deleting it will also remove the payment transaction from <strong>{deleteSelling.supplier_name}</strong>'s balance!
                </div>
              )}
            </div>
          }
          busy={deleting}
          onConfirm={handleDelete}
          onCancel={() => setDeleteSelling(null)}
        />
      )}
    </div>
  )
}
