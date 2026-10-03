import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { formatINR, formatDate } from '../lib/utils'
import PaymentForm from '../components/PaymentForm'
import PaymentReceipt from '../components/PaymentReceipt'
import DoubleConfirm from '../components/DoubleConfirm'

export default function Payments() {
  const [payments, setPayments] = useState([])
  const [parties, setParties] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterParty, setFilterParty] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editPayment, setEditPayment] = useState(null)
  const [editParty, setEditParty] = useState(null)
  const [receiptPayment, setReceiptPayment] = useState(null)
  const [deletePayment, setDeletePayment] = useState(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const today = new Date().toISOString().split('T')[0]
    const [{ data: pay }, { data: par }] = await Promise.all([
      supabase.from('party_payments')
        .select('*, party:parties(id,name), mode:payment_modes(id,name,needs_reference)')
        .order('payment_date', { ascending: false }),
      supabase.from('parties').select('id,name').eq('is_active', true).order('name'),
    ])
    setPayments((pay||[]).map(p => ({
      ...p,
      party_name: p.party?.name,
      mode_name: p.mode?.name,
      needs_reference: p.mode?.needs_reference,
      is_scheduled: p.payment_date > today,
    })))
    setParties(par||[])
    setLoading(false)
  }

  async function handleDelete() {
    setDeleting(true)
    await supabase.from('party_payments').delete().eq('id', deletePayment.id)
    setDeleting(false)
    setDeletePayment(null)
    load()
  }

  function openEdit(p) {
    setEditParty({ party_id: p.party_id || p.party?.id, party_name: p.party_name, outstanding: 0 })
    setEditPayment(p)
    setShowForm(true)
  }

  const filtered = payments.filter(p => {
    const s = search.toLowerCase()
    const matchSearch = !search || p.party_name?.toLowerCase().includes(s) || p.reference_no?.toLowerCase().includes(s) || p.mode_name?.toLowerCase().includes(s)
    const matchParty = !filterParty || p.party_id === filterParty
    return matchSearch && matchParty
  })

  const total = filtered.reduce((s,p) => s+Number(p.amount), 0)

  if (loading) return <div className="spinner-wrap"><div className="spinner" />Loading payments…</div>

  return (
    <div>
      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 800 }}>Payments</h1>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
              {payments.length} entries · {formatINR(payments.reduce((s,p)=>s+Number(p.amount),0))} total
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-ghost btn-sm" onClick={load}>🔄 Refresh</button>
            <button className="btn btn-primary" onClick={() => { setEditPayment(null); setEditParty(null); setShowForm(true) }}>
              + Record Payment
            </button>
          </div>
        </div>
      </div>

      <div className="page-body">
        <div className="flex gap-3" style={{ flexWrap:'wrap', marginBottom:16 }}>
          <div className="search-box" style={{ flex:1, minWidth:200 }}>
            <span className="search-icon">🔍</span>
            <input className="input" placeholder="Search party, mode, reference…" value={search} onChange={e=>setSearch(e.target.value)} />
          </div>
          <select className="select" style={{ width:200 }} value={filterParty} onChange={e=>setFilterParty(e.target.value)}>
            <option value="">All Suppliers</option>
            {parties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        {filtered.length > 0 && (
          <div style={{ display:'flex', gap:14, marginBottom:16 }}>
            <div className="kpi-card" style={{ padding:'12px 18px', flex:'0 0 auto' }}>
              <div className="kpi-label">Filtered Total</div>
              <div style={{ fontSize:20, fontWeight:800, color:'var(--green)', marginTop:4 }}>{formatINR(total)}</div>
            </div>
            <div className="kpi-card" style={{ padding:'12px 18px', flex:'0 0 auto' }}>
              <div className="kpi-label">Entries</div>
              <div style={{ fontSize:20, fontWeight:800, marginTop:4 }}>{filtered.length}</div>
            </div>
          </div>
        )}

        <div className="table-wrapper">
          <div className="table-header">
            <div className="table-title">Payment Register</div>
            <div style={{ fontSize:12, color:'var(--text-muted)' }}>{filtered.length} shown</div>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Supplier</th>
                  <th>Mode</th>
                  <th>Reference</th>
                  <th className="td-right">Amount</th>
                  <th>Remarks</th>
                  <th style={{ textAlign:'center', width:110 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => (
                  <tr key={p.id}>
                    <td style={{ fontWeight:500 }}>{formatDate(p.payment_date)}</td>
                    <td className="td-primary" style={{ fontWeight:700 }}>{p.party_name}</td>
                    <td><span className="badge badge-blue">{p.mode_name}</span></td>
                    <td className="td-mono" style={{ fontSize:12, color:'var(--text-muted)' }}>{p.reference_no || '—'}</td>
                    <td className="td-right td-mono" style={{ fontWeight:800, fontSize:15, color:'var(--green)' }}>
                      {formatINR(p.amount)}
                    </td>
                    <td style={{ fontSize:12, color:'var(--text-muted)', maxWidth:160, overflow:'hidden', textOverflow:'ellipsis' }}>{p.remarks || '—'}</td>
                    <td>
                      <div style={{ display:'flex', gap:4, justifyContent:'center' }}>
                        {/* 🧾 Receipt */}
                        <button title="View Receipt" onClick={() => setReceiptPayment(p)}
                          style={{ background:'none', border:'1px solid var(--border)', borderRadius:6, cursor:'pointer', width:30, height:30, display:'flex', alignItems:'center', justifyContent:'center', fontSize:15 }}
                          onMouseEnter={e=>e.currentTarget.style.background='var(--blue-bg)'}
                          onMouseLeave={e=>e.currentTarget.style.background='none'}
                        >🧾</button>
                        {/* ✏️ Edit */}
                        <button title="Edit" onClick={() => openEdit(p)}
                          style={{ background:'none', border:'1px solid var(--border)', borderRadius:6, cursor:'pointer', width:30, height:30, display:'flex', alignItems:'center', justifyContent:'center', fontSize:14 }}
                          onMouseEnter={e=>e.currentTarget.style.background='var(--yellow-bg)'}
                          onMouseLeave={e=>e.currentTarget.style.background='none'}
                        >✏️</button>
                        {/* 🗑️ Delete */}
                        <button title="Delete" onClick={() => setDeletePayment(p)}
                          style={{ background:'none', border:'1px solid var(--red-border)', borderRadius:6, cursor:'pointer', width:30, height:30, display:'flex', alignItems:'center', justifyContent:'center', fontSize:14 }}
                          onMouseEnter={e=>e.currentTarget.style.background='var(--red-bg)'}
                          onMouseLeave={e=>e.currentTarget.style.background='none'}
                        >🗑️</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && <div className="empty-state"><div className="empty-icon">💳</div><p>No payments found</p></div>}
          </div>
        </div>
      </div>

      {/* Payment Form (new or edit) */}
      {showForm && (
        <PaymentFormWrapper
          party={editParty}
          payment={editPayment}
          parties={parties}
          onClose={() => { setShowForm(false); setEditPayment(null); setEditParty(null) }}
          onSaved={() => { load() }}
        />
      )}

      {/* Receipt */}
      {receiptPayment && (
        <PaymentReceipt
          payment={receiptPayment}
          party={{ party_name: receiptPayment.party_name, outstanding: 0 }}
          onClose={() => setReceiptPayment(null)}
        />
      )}

      {/* Double Confirm Delete */}
      {deletePayment && (
        <DoubleConfirm
          title="Delete Payment?"
          body={<><strong>{deletePayment.party_name}</strong><br/>{formatDate(deletePayment.payment_date)} · <strong>{formatINR(deletePayment.amount)}</strong> via {deletePayment.mode_name}<br/><span style={{ fontSize:12,color:'var(--text-muted)',marginTop:4,display:'block' }}>This permanently removes this payment and recalculates all FIFO allocations.</span></>}
          onConfirm={handleDelete}
          onCancel={() => setDeletePayment(null)}
          busy={deleting}
        />
      )}
    </div>
  )
}

// Wrapper: if no party pre-selected, show party picker first
function PaymentFormWrapper({ party, payment, parties, onClose, onSaved }) {
  const [selectedId, setSelectedId] = useState(party?.party_id || '')
  const [selectedParty, setSelectedParty] = useState(party || null)

  useEffect(() => {
    if (selectedId && !party) {
      supabase.rpc('fn_party_summary', { p_as_of: new Date().toISOString().split('T')[0] })
        .then(({ data }) => setSelectedParty((data||[]).find(x => x.party_id === selectedId) || null))
    }
  }, [selectedId])

  if (!selectedParty) return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth:400 }} onClick={e=>e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">💳 Record Payment</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="form-group">
          <label className="form-label">Select Supplier *</label>
          <select className="select" autoFocus value={selectedId} onChange={e=>setSelectedId(e.target.value)}>
            <option value="">Choose a supplier…</option>
            {parties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )

  return <PaymentForm party={selectedParty} payment={payment} onClose={onClose} onSaved={onSaved} />
}
