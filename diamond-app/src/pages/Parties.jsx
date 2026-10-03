import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { formatINR, formatDate, flagIcon } from '../lib/utils'
import PartyDetail from '../components/PartyDetail'
import PartyForm from '../components/PartyForm'
import PaymentForm from '../components/PaymentForm'

export default function Parties({ onNavigate }) {
  const [parties, setParties] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterFlag, setFilterFlag] = useState('ALL')
  const [selected, setSelected] = useState(null)
  const [showPartyForm, setShowPartyForm] = useState(false)
  const [showPayForm, setShowPayForm] = useState(false)
  const [payParty, setPayParty] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const today = new Date().toISOString().split('T')[0]
    const { data } = await supabase.rpc('fn_party_summary', { p_as_of: today })
    setParties((data || []).sort((a,b) => (a.priority_rank||99)-(b.priority_rank||99)))
    setLoading(false)
  }

  const filtered = parties.filter(p => {
    const s = search.toLowerCase()
    const matchSearch = !search || p.party_name?.toLowerCase().includes(s) || p.broker_name?.toLowerCase().includes(s)
    const matchFlag = filterFlag === 'ALL' || p.flag === filterFlag
    return matchSearch && matchFlag
  })

  if (loading) return <div className="spinner-wrap"><div className="spinner" />Loading suppliers…</div>

  if (selected) return (
    <PartyDetail
      party={selected}
      onBack={() => { setSelected(null); load() }}
      onReload={load}
    />
  )

  return (
    <div>
      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 800 }}>Suppliers</h1>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
              {parties.length} total · {parties.filter(p=>p.is_active).length} active
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-ghost btn-sm" onClick={load}>🔄</button>
            <button className="btn btn-primary" onClick={() => setShowPartyForm(true)}>+ Add Supplier</button>
          </div>
        </div>
      </div>

      <div className="page-body">
        <div className="flex gap-3" style={{ flexWrap: 'wrap', marginBottom: 16 }}>
          <div className="search-box" style={{ flex: 1, minWidth: 200 }}>
            <span className="search-icon">🔍</span>
            <input className="input" placeholder="Search suppliers…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="tabs">
            {['ALL','GREEN','YELLOW','RED'].map(f => (
              <button key={f} className={`tab ${filterFlag===f?'active':''}`} onClick={() => setFilterFlag(f)}>
                {f==='ALL' ? 'All' : `${f==='GREEN'?'🟢':f==='YELLOW'?'🟡':'🔴'} ${f}`}
              </button>
            ))}
          </div>
        </div>

        <div className="table-wrapper">
          <div className="table-header">
            <div className="table-title">Supplier Master</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{filtered.length} shown</div>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th>Flag</th>
                  <th className="td-right">Outstanding</th>
                  <th className="td-right">Overdue</th>
                  <th>Last Payment</th>
                  <th>Next Due</th>
                  <th style={{ textAlign: 'center', width: 80 }}>Pay</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => (
                  <tr key={p.party_id} onClick={() => setSelected(p)} style={{ cursor: 'pointer' }}>
                    <td>
                      <div className="td-primary" style={{ fontWeight: 700, fontSize: 14 }}>{p.party_name}</div>
                      {p.broker_name && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>via {p.broker_name}</div>}
                    </td>
                    <td>
                      <span className={`flag-badge flag-${p.flag}`}>{flagIcon(p.flag)} {p.flag_label}</span>
                    </td>
                    <td className="td-right td-mono" style={{ fontWeight: 700, fontSize: 14 }}>{formatINR(p.outstanding)}</td>
                    <td className="td-right td-mono" style={{ color: p.overdue_amount>0?'var(--red)':undefined, fontWeight: p.overdue_amount>0?700:400 }}>
                      {p.overdue_amount > 0 ? formatINR(p.overdue_amount) : '—'}
                    </td>
                    <td>
                      {p.last_payment_date
                        ? <div>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>{formatINR(p.last_payment_amount)}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{formatDate(p.last_payment_date)}</div>
                          </div>
                        : <span className="text-muted text-sm">Never</span>}
                    </td>
                    <td style={{ fontSize: 12 }}>{p.next_due_date ? formatDate(p.next_due_date) : '—'}</td>
                    <td onClick={e => e.stopPropagation()} style={{ textAlign: 'center' }}>
                      <button
                        className="btn btn-primary btn-sm"
                        style={{ whiteSpace: 'nowrap', padding: '6px 12px' }}
                        onClick={() => { setPayParty(p); setShowPayForm(true) }}
                      >
                        💳 Pay
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && <div className="empty-state"><div className="empty-icon">🏢</div><p>No suppliers found</p></div>}
          </div>
        </div>
      </div>

      {showPartyForm && (
        <PartyForm
          party={null}
          onClose={() => setShowPartyForm(false)}
          onSaved={() => { setShowPartyForm(false); load() }}
        />
      )}

      {showPayForm && payParty && (
        <PaymentForm
          party={payParty}
          onClose={() => { setShowPayForm(false); setPayParty(null) }}
          onSaved={() => { setShowPayForm(false); setPayParty(null); load() }}
        />
      )}
    </div>
  )
}
