import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { formatINR, formatDate } from '../lib/utils'

export default function Dashboard() {
  const [totals, setTotals] = useState(null)
  const [parties, setParties] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    const today = new Date().toISOString().split('T')[0]
    const [{ data: tArr }, { data: p }] = await Promise.all([
      supabase.rpc('fn_dashboard_totals', { p_as_of: today }),
      supabase.rpc('fn_party_summary', { p_as_of: today }),
    ])
    setTotals(tArr?.[0] || null)
    setParties(p || [])
    setLoading(false)
  }

  if (loading) return (
    <div className="spinner-wrap">
      <div className="spinner" />
      Loading dashboard…
    </div>
  )

  const red    = parties.filter(p => p.flag === 'RED')
  const yellow = parties.filter(p => p.flag === 'YELLOW')
  const green  = parties.filter(p => p.flag === 'GREEN')

  return (
    <div>
      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)' }}>Dashboard</h1>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
              As of {formatDate(totals?.as_of_date)} · {totals?.parties} active suppliers
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={loadData}>🔄 Refresh</button>
        </div>
      </div>

      <div className="page-body">
        {/* Flag summary */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
          {[
            { label: 'Critical / Red', count: totals?.red_parties, color: '#dc2626', bg: 'var(--red-bg)', icon: '🔴' },
            { label: 'Attention / Yellow', count: totals?.yellow_parties, color: 'var(--yellow-light)', bg: 'var(--yellow-bg)', icon: '🟡' },
            { label: 'All Clear / Green', count: totals?.green_parties, color: 'var(--green)', bg: 'var(--green-bg)', icon: '🟢' },
          ].map(f => (
            <div key={f.label} style={{
              flex: 1, background: f.bg, border: `1px solid ${f.color}30`,
              borderRadius: 'var(--radius-lg)', padding: '16px 20px',
              display: 'flex', alignItems: 'center', gap: 14
            }}>
              <div style={{ fontSize: 28 }}>{f.icon}</div>
              <div>
                <div style={{ fontSize: 28, fontWeight: 800, color: f.color }}>{f.count ?? 0}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>{f.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* ── Hero summary: Outstanding & Overdue ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
          {/* Outstanding tile */}
          <div style={{
            background: 'linear-gradient(135deg, #1a56db 0%, #1338a0 100%)',
            borderRadius: 16, padding: '24px 26px',
            boxShadow: '0 6px 24px rgba(26,86,219,0.30)',
            position: 'relative', overflow: 'hidden',
            color: 'white',
          }}>
            <div style={{ position: 'absolute', top: -18, right: -18, fontSize: 80, opacity: 0.10 }}>⏳</div>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.75, marginBottom: 10 }}>
              Total Outstanding
            </div>
            <div style={{ fontSize: 36, fontWeight: 900, letterSpacing: '-0.02em', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>
              {formatINR(totals?.outstanding)}
            </div>
            <div style={{ marginTop: 12, fontSize: 12, opacity: 0.70, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ background: 'rgba(255,255,255,0.2)', borderRadius: 20, padding: '2px 10px', fontWeight: 600 }}>
                {totals?.parties ?? 0} active suppliers
              </span>
            </div>
          </div>

          {/* Overdue tile */}
          <div style={{
            background: Number(totals?.overdue_amount) > 0
              ? 'linear-gradient(135deg, #dc2626 0%, #991b1b 100%)'
              : 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)',
            borderRadius: 16, padding: '24px 26px',
            boxShadow: Number(totals?.overdue_amount) > 0
              ? '0 6px 24px rgba(220,38,38,0.30)'
              : '0 6px 24px rgba(22,163,74,0.25)',
            position: 'relative', overflow: 'hidden',
            color: 'white',
          }}>
            <div style={{ position: 'absolute', top: -18, right: -18, fontSize: 80, opacity: 0.10 }}>⚠️</div>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.75, marginBottom: 10 }}>
              Overdue Amount
            </div>
            <div style={{ fontSize: 36, fontWeight: 900, letterSpacing: '-0.02em', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>
              {Number(totals?.overdue_amount) > 0 ? formatINR(totals?.overdue_amount) : '✅ Nil'}
            </div>
            <div style={{ marginTop: 12, fontSize: 12, opacity: 0.75, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ background: 'rgba(255,255,255,0.2)', borderRadius: 20, padding: '2px 10px', fontWeight: 600 }}>
                {Number(totals?.overdue_amount) > 0 ? `${totals?.red_parties ?? 0} critical suppliers` : 'All accounts current'}
              </span>
            </div>
          </div>
        </div>

        {/* KPIs — remaining metrics */}
        <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', marginBottom: 20 }}>
          {[
            { label: 'Total Payable', value: formatINR(totals?.total_payable), icon: '💰' },
            { label: 'Total Paid',    value: formatINR(totals?.total_paid),    icon: '✅' },
            { label: 'Advance',       value: formatINR(totals?.advance),       icon: '➕' },
            { label: 'Due Soon (7d)', value: formatINR(totals?.due_soon_amount),icon: '📅' },
            { label: 'Total Weight',  value: `${Number(totals?.total_weight||0).toFixed(2)} ct`, icon: '⚖️' },
            { label: 'QC Return Wt',  value: `${Number(totals?.qc_return_weight||0).toFixed(2)} ct`, icon: '🔁' },
          ].map(k => (
            <div key={k.label} className="kpi-card">
              <div className="kpi-icon">{k.icon}</div>
              <div className="kpi-label">{k.label}</div>
              <div className="kpi-value" style={{ fontSize: 18 }}>{k.value}</div>
            </div>
          ))}
        </div>

        {/* Priority list */}
        <div className="table-wrapper">
          <div className="table-header">
            <div className="table-title">🎯 Supplier Priority List</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Sorted by urgency</div>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Supplier</th>
                  <th>Flag</th>
                  <th className="td-right">Outstanding</th>
                  <th className="td-right">Overdue</th>
                  <th>Oldest Overdue</th>
                  <th className="td-right">Last Payment</th>
                  <th>Next Due</th>
                </tr>
              </thead>
              <tbody>
                {parties.map(p => (
                  <tr key={p.party_id}>
                    <td className="td-muted text-muted">{p.priority_rank}</td>
                    <td className="td-primary">
                      <div style={{ fontWeight: 700 }}>{p.party_name}</div>
                      {p.broker_name && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>C/O {p.broker_name}</div>}
                    </td>
                    <td>
                      <span className={`flag-badge flag-${p.flag}`}>
                        {p.flag === 'GREEN' ? '🟢' : p.flag === 'YELLOW' ? '🟡' : '🔴'} {p.flag_label}
                      </span>
                    </td>
                    <td className="td-right td-mono">{formatINR(p.outstanding)}</td>
                    <td className="td-right td-mono" style={{ color: p.overdue_amount > 0 ? 'var(--red)' : 'var(--text-muted)' }}>
                      {p.overdue_amount > 0 ? formatINR(p.overdue_amount) : '—'}
                    </td>
                    <td>
                      {p.oldest_overdue_bill ? (
                        <span style={{ fontSize: 12, color: 'var(--red)' }}>
                          {p.oldest_overdue_bill} · {p.max_days_overdue}d
                        </span>
                      ) : '—'}
                    </td>
                    <td className="td-right">
                      {p.last_payment_date ? (
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600 }}>{formatINR(p.last_payment_amount)}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{formatDate(p.last_payment_date)}</div>
                        </div>
                      ) : <span className="text-muted">Never</span>}
                    </td>
                    <td>
                      {p.next_due_date ? (
                        <div>
                          <div style={{ fontSize: 12 }}>{formatDate(p.next_due_date)}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{formatINR(p.next_due_amount)}</div>
                        </div>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
