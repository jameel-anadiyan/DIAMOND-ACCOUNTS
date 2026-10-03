import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { formatINR, formatDate } from '../lib/utils'
import PaymentReceipt from './PaymentReceipt'

export default function PaymentForm({ party, payment: existingPayment, onClose, onSaved }) {
  const isEdit = !!existingPayment
  const [modes, setModes] = useState([])
  const [preview, setPreview] = useState([])
  const [form, setForm] = useState({
    amount: existingPayment?.amount || '',
    payment_date: existingPayment?.payment_date || new Date().toISOString().split('T')[0],
    mode_id: existingPayment?.mode_id || '',
    reference_no: existingPayment?.reference_no || '',
    remarks: existingPayment?.remarks || '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [savedPayment, setSavedPayment] = useState(null)
  const [loadingPreview, setLoadingPreview] = useState(false)

  useEffect(() => {
    supabase.from('payment_modes').select('*').eq('is_active', true).order('sort_order')
      .then(({ data }) => {
        setModes(data || [])
        if (!isEdit && data?.length) setForm(f => ({ ...f, mode_id: data[0].id }))
      })
  }, [])

  useEffect(() => {
    if (Number(form.amount) > 0 && !isEdit) loadPreview()
    else setPreview([])
  }, [form.amount])

  async function loadPreview() {
    setLoadingPreview(true)
    const { data } = await supabase.rpc('fn_preview_payment', {
      p_party_id: party.party_id || party.id,
      p_amount: Number(form.amount),
      p_as_of: new Date().toISOString().split('T')[0],
    })
    setPreview(data || [])
    setLoadingPreview(false)
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const selectedMode = modes.find(m => m.id == form.mode_id)

  async function save(e) {
    e.preventDefault()
    setSaving(true); setError('')
    const payload = {
      payment_date: form.payment_date,
      amount: Number(form.amount),
      mode_id: Number(form.mode_id),
      reference_no: form.reference_no || null,
      remarks: form.remarks || null,
    }
    let err
    if (isEdit) {
      ;({ error: err } = await supabase.from('party_payments').update(payload).eq('id', existingPayment.id))
    } else {
      ;({ error: err } = await supabase.from('party_payments').insert({
        ...payload, party_id: party.party_id || party.id,
      }))
    }
    if (err) { setError(err.message); setSaving(false); return }
    setSavedPayment({ ...form, mode_name: selectedMode?.name })
    onSaved()
  }

  if (savedPayment) {
    return <PaymentReceipt payment={savedPayment} party={party} onClose={onClose} />
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            {isEdit ? '✏️ Edit Payment' : '💳 Record Payment'} — {party.party_name || party.name}
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: isEdit ? '1fr' : '1fr 1fr', gap: 28 }}>
          <form id="pay-form" onSubmit={save}>
            <div className="form-group">
              <label className="form-label">Amount (₹) *</label>
              <input className="input" type="number" min="0.01" step="0.01"
                value={form.amount} onChange={e => set('amount', e.target.value)}
                placeholder="e.g. 500000" required style={{ fontSize: 18, fontWeight: 700 }} />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Payment Date *</label>
                <input className="input" type="date" value={form.payment_date}
                  onChange={e => set('payment_date', e.target.value)} required />
              </div>
              <div className="form-group">
                <label className="form-label">Mode *</label>
                <select className="select" value={form.mode_id}
                  onChange={e => set('mode_id', e.target.value)} required>
                  <option value="">Select…</option>
                  {modes.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
            </div>
            {(selectedMode?.needs_reference || form.reference_no) && (
              <div className="form-group">
                <label className="form-label">UTR / Reference No {selectedMode?.needs_reference ? '*' : ''}</label>
                <input className="input" value={form.reference_no}
                  onChange={e => set('reference_no', e.target.value)}
                  placeholder="UTR or cheque number"
                  required={selectedMode?.needs_reference} />
              </div>
            )}
            <div className="form-group">
              <label className="form-label">Remarks</label>
              <input className="input" value={form.remarks}
                onChange={e => set('remarks', e.target.value)} placeholder="Optional note" />
            </div>

            {!isEdit && (
              <div style={{ background: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)', padding: '12px 14px', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase' }}>Current Position</div>
                <div style={{ display: 'flex', gap: 20 }}>
                  <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Outstanding</div><div style={{ fontWeight: 700, fontSize: 15 }}>{formatINR(party.outstanding)}</div></div>
                  <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Overdue</div><div style={{ fontWeight: 700, fontSize: 15, color: party.overdue_amount > 0 ? 'var(--red)' : 'var(--text-muted)' }}>{formatINR(party.overdue_amount)}</div></div>
                </div>
              </div>
            )}
          </form>

          {!isEdit && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 12, textTransform: 'uppercase' }}>FIFO Allocation Preview</div>
              {loadingPreview && <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Calculating…</div>}
              {!loadingPreview && form.amount > 0 && preview.map((row, i) => (
                <div key={i} style={{ background: row.status_after==='PAID'?'var(--green-bg)':'var(--bg-elevated)', border:`1px solid ${row.status_after==='PAID'?'var(--green-border)':'var(--border)'}`, borderRadius:'var(--radius-sm)', padding:'10px 13px', marginBottom:7 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                    <span style={{ fontSize:13, fontWeight:700 }}>{row.bill_no || 'Advance'}</span>
                    <span className={`flag-badge ${row.status_after==='PAID'?'flag-GREEN':'flag-YELLOW'}`} style={{ fontSize:11 }}>{row.status_after}</span>
                  </div>
                  <div style={{ fontSize:12, color:'var(--text-muted)', display:'flex', gap:14 }}>
                    <span>Balance: {formatINR(row.balance_before)}</span>
                    <span style={{ color:'var(--green)', fontWeight:600 }}>Applying: {formatINR(row.applied)}</span>
                  </div>
                </div>
              ))}
              {!loadingPreview && !form.amount && (
                <div style={{ color:'var(--text-faint)', fontSize:13, padding:16, background:'var(--bg-elevated)', borderRadius:'var(--radius-md)', textAlign:'center' }}>
                  Enter an amount to see bill allocation
                </div>
              )}
            </div>
          )}
        </div>

        {error && <div style={{ color:'var(--red)', fontSize:12, marginTop:12 }}>{error}</div>}
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" form="pay-form" className="btn btn-primary btn-lg" disabled={saving}>
            {saving ? 'Saving…' : isEdit ? '✏️ Update Payment' : `💳 Record ${form.amount ? formatINR(Number(form.amount)) : 'Payment'}`}
          </button>
        </div>
      </div>
    </div>
  )
}
