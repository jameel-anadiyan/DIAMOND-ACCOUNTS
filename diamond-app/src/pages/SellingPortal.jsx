import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { formatINR, formatDate, formatWeight, getDaysLeft } from '../lib/utils'
import { getSellingRecords, deleteSellingRecord, toggleSettlementMode } from '../lib/sellingService'
import SellingForm from '../components/SellingForm'
import DoubleConfirm from '../components/DoubleConfirm'

export default function SellingPortal({ onNavigate }) {
  const [sellings, setSellings] = useState([])
  const [parties, setParties] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterParty, setFilterParty] = useState('')
  const [filterTab, setFilterTab] = useState('ALL') // ALL | OVERDUE | DUE_SOON | UPCOMING | ADJUSTED | COLLECTED
  const [showForm, setShowForm] = useState(false)
  const [editSelling, setEditSelling] = useState(null)
  const [deleteSelling, setDeleteSelling] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [togglingId, setTogglingId] = useState(null)
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

  async function handleToggleSwitch(item) {
    if (togglingId) return
    setTogglingId(item.id)
    try {
      await toggleSettlementMode(item)
      load()
    } catch (err) {
      console.error('Failed to toggle settlement mode:', err)
      alert('Error updating settlement mode: ' + err.message)
    } finally {
      setTogglingId(null)
    }
  }

  function toggleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  // Calculate statistics across all selling records
  const totalAmountAll = sellings.reduce((s, x) => s + (Number(x.total_amount) || 0), 0)
  const totalWeightAll = sellings.reduce((s, x) => s + (Number(x.quantity) || 0), 0)
  const adjustedTotalAll = sellings.filter(x => x.payment_type === 'adjusted').reduce((s, x) => s + (Number(x.total_amount) || 0), 0)
  const collectedTotalAll = sellings.filter(x => x.payment_type === 'collected').reduce((s, x) => s + (Number(x.total_amount) || 0), 0)

  // Status counters
  const overdueItems = sellings.filter(x => {
    const d = getDaysLeft(x.due_date, today)
    return d.status === 'overdue'
  })
  const dueSoonItems = sellings.filter(x => {
    const d = getDaysLeft(x.due_date, today)
    return d.status === 'due_soon' || d.status === 'today'
  })

  // Filter and sort items
  const filtered = sellings
    .filter(item => {
      const s = search.toLowerCase()
      const matchSearch = !search ||
        item.title?.toLowerCase().includes(s) ||
        item.supplier_name?.toLowerCase().includes(s) ||
        item.remarks?.toLowerCase().includes(s)

      const matchParty = !filterParty || item.supplier_id === filterParty

      let matchTab = true
      const d = getDaysLeft(item.due_date, today)
      if (filterTab === 'OVERDUE') matchTab = (d.status === 'overdue')
      else if (filterTab === 'DUE_SOON') matchTab = (d.status === 'due_soon' || d.status === 'today')
      else if (filterTab === 'UPCOMING') matchTab = (d.status === 'upcoming')
      else if (filterTab === 'ADJUSTED') matchTab = (item.payment_type === 'adjusted')
      else if (filterTab === 'COLLECTED') matchTab = (item.payment_type === 'collected')

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
          <div>
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
            <div className="kpi-sub">{sellings.length} total selling orders</div>
          </div>

          <div className="kpi-card">
            <div className="kpi-icon">⚖️</div>
            <div className="kpi-label">Total Carats Sold</div>
            <div className="kpi-value">{formatWeight(totalWeightAll)}</div>
            <div className="kpi-sub">
              Avg: {totalWeightAll > 0 ? formatINR(totalAmountAll / totalWeightAll) + ' / ct' : '—'}
            </div>
          </div>

          <div className="kpi-card">
            <div className="kpi-icon">🤝</div>
            <div className="kpi-label">Adjusted to Balance</div>
            <div className="kpi-value" style={{ color: 'var(--green)' }}>{formatINR(adjustedTotalAll)}</div>
            <div className="kpi-sub">
              {sellings.filter(x => x.payment_type === 'adjusted').length} sales settled in supplier ledger
            </div>
          </div>

          <div className="kpi-card">
            <div className="kpi-icon">💵</div>
            <div className="kpi-label">Collected Amount</div>
            <div className="kpi-value" style={{ color: 'var(--blue)' }}>{formatINR(collectedTotalAll)}</div>
            <div className="kpi-sub">
              {sellings.filter(x => x.payment_type === 'collected').length} sales collected directly
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
              placeholder="Search title, supplier, remarks…"
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
              className={`tab ${filterTab === 'OVERDUE' ? 'active' : ''}`}
              onClick={() => setFilterTab('OVERDUE')}
              style={{ color: overdueItems.length > 0 && filterTab !== 'OVERDUE' ? 'var(--red)' : undefined }}
            >
              🔴 Overdue ({overdueItems.length})
            </button>
            <button
              className={`tab ${filterTab === 'DUE_SOON' ? 'active' : ''}`}
              onClick={() => setFilterTab('DUE_SOON')}
              style={{ color: dueSoonItems.length > 0 && filterTab !== 'DUE_SOON' ? 'var(--yellow)' : undefined }}
            >
              ⚠️ Due Soon ({dueSoonItems.length})
            </button>
            <button
              className={`tab ${filterTab === 'ADJUSTED' ? 'active' : ''}`}
              onClick={() => setFilterTab('ADJUSTED')}
            >
              ⚖️ Adjusted ({sellings.filter(x => x.payment_type === 'adjusted').length})
            </button>
            <button
              className={`tab ${filterTab === 'COLLECTED' ? 'active' : ''}`}
              onClick={() => setFilterTab('COLLECTED')}
            >
              💵 Collected ({sellings.filter(x => x.payment_type === 'collected').length})
            </button>
          </div>
        </div>

        {/* Filtered KPIs info */}
        {(search || filterParty || filterTab !== 'ALL') && (
          <div style={{ display: 'flex', gap: 14, marginBottom: 14, alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Filtered: <strong>{filtered.length}</strong> sales totaling <strong>{formatINR(filteredTotal)}</strong> ({formatWeight(filteredWeight)})
            </span>
            {(search || filterParty || filterTab !== 'ALL') && (
              <button
                className="btn btn-ghost btn-sm"
                style={{ padding: '2px 8px', fontSize: 11 }}
                onClick={() => { setSearch(''); setFilterParty(''); setFilterTab('ALL') }}
              >
                Clear filters
              </button>
            )}
          </div>
        )}

        {/* Selling Records Table */}
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
                    Weight (ct) {sortCol === 'quantity' ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                  </th>
                  <th className="td-right" onClick={() => toggleSort('carat_rate')}>
                    Rate / ct {sortCol === 'carat_rate' ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
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
                  <th style={{ textAlign: 'center' }}>Settlement Switch</th>
                  <th style={{ textAlign: 'center', width: 90 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={10}>
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
                    const isAdjusted = item.payment_type === 'adjusted'
                    const isToggling = togglingId === item.id

                    return (
                      <tr key={item.id}>
                        {/* Title */}
                        <td className="td-primary">
                          <div style={{ fontWeight: 700, fontSize: 14 }}>{item.title}</div>
                          {item.remarks && (
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.remarks}>
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

                        {/* Date */}
                        <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                          {formatDate(item.selling_date)}
                        </td>

                        {/* Quantity */}
                        <td className="td-right td-mono" style={{ fontWeight: 600 }}>
                          {Number(item.quantity).toFixed(3)} ct
                        </td>

                        {/* Carat Rate */}
                        <td className="td-right td-mono" style={{ fontSize: 13 }}>
                          ₹{Number(item.carat_rate).toLocaleString('en-IN')}
                        </td>

                        {/* Total Amount */}
                        <td className="td-right td-mono" style={{ fontSize: 15, fontWeight: 800, color: 'var(--green-light)' }}>
                          {formatINR(item.total_amount)}
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
                              letterSpacing: '0.02em'
                            }}
                          >
                            {daysInfo.icon} {daysInfo.text}
                          </span>
                        </td>

                        {/* Settlement Switch */}
                        <td style={{ textAlign: 'center' }}>
                          <button
                            type="button"
                            onClick={() => handleToggleSwitch(item)}
                            disabled={isToggling}
                            title={isAdjusted
                              ? 'Click to switch to Collected Amount (removes payment from supplier balance)'
                              : 'Click to switch to Adjusted to Balance (enters payment to supplier)'}
                            style={{
                              border: isAdjusted ? '1px solid var(--green-border)' : '1px solid var(--blue-border)',
                              background: isAdjusted ? 'var(--green-bg)' : 'var(--blue-bg)',
                              color: isAdjusted ? 'var(--green-light)' : 'var(--accent)',
                              padding: '5px 12px',
                              borderRadius: 20,
                              cursor: 'pointer',
                              fontWeight: 700,
                              fontSize: 12,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                              transition: 'all 0.15s ease',
                              opacity: isToggling ? 0.6 : 1
                            }}
                          >
                            <span>{isAdjusted ? '⚖️' : '💵'}</span>
                            <span>{isAdjusted ? 'Adjusted to Balance' : 'Collected Amount'}</span>
                            {isAdjusted && (
                              <span style={{ fontSize: 10, background: 'var(--green)', color: 'white', borderRadius: '50%', width: 14, height: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                                ✓
                              </span>
                            )}
                          </button>
                          {isAdjusted && (
                            <div
                              style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, cursor: onNavigate ? 'pointer' : 'default' }}
                              onClick={() => onNavigate && onNavigate('payments')}
                              title={onNavigate ? "Click to view in Payments Register" : undefined}
                            >
                              Payment entered in ledger ↗
                            </div>
                          )}
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
                                transition: 'var(--transition)'
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
                                transition: 'var(--transition)'
                              }}
                              onMouseEnter={e => e.currentTarget.style.background = 'var(--red-bg)'}
                              onMouseLeave={e => e.currentTarget.style.background = 'none'}
                            >
                              🗑️
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Add / Edit Form Modal */}
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
