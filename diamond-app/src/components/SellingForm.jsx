import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { formatINR, getDaysLeft } from '../lib/utils'
import { saveSellingRecord } from '../lib/sellingService'

export default function SellingForm({ selling: existingSelling, onClose, onSaved }) {
  const isEdit = !!existingSelling
  const today = new Date().toISOString().split('T')[0]

  const [parties, setParties] = useState([])
  const [form, setForm] = useState({
    title:        existingSelling?.title        || '',
    supplier_id:  existingSelling?.supplier_id  || '',
    quantity:     existingSelling?.quantity     || '',
    carat_rate:   existingSelling?.carat_rate   || '',
    total_amount: existingSelling?.total_amount || '',
    selling_date: existingSelling?.selling_date || today,
    due_date:     existingSelling?.due_date     || '',
    payment_type: existingSelling?.payment_type || 'collected', // 'collected' | 'adjusted'
    remarks:      existingSelling?.remarks      || '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.from('parties').select('id, name, default_term_days').eq('is_active', true).order('name')
      .then(({ data }) => {
        setParties(data || [])
      })
  }, [])

  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }))

  function handleQuantityChange(val) {
    const q = parseFloat(val) || 0
    const r = parseFloat(form.carat_rate) || 0
    setForm(f => ({
      ...f,
      quantity: val,
      total_amount: q > 0 && r > 0 ? (q * r).toFixed(2) : (val === '' ? '' : f.total_amount)
    }))
  }

  function handleCaratRateChange(val) {
    const q = parseFloat(form.quantity) || 0
    const r = parseFloat(val) || 0
    setForm(f => ({
      ...f,
      carat_rate: val,
      total_amount: q > 0 && r > 0 ? (q * r).toFixed(2) : (val === '' ? '' : f.total_amount)
    }))
  }

  function handleSupplierChange(id) {
    setF('supplier_id', id)
    const p = parties.find(x => x.id === id)
    if (p && !form.due_date) {
      // Suggest due date based on supplier default term days
      const d = new Date(form.selling_date || today)
      d.setDate(d.getDate() + (p.default_term_days || 90))
      setF('due_date', d.toISOString().split('T')[0])
    }
  }

  function addDaysToDueDate(days) {
    const base = new Date(form.selling_date || today)
    base.setDate(base.getDate() + days)
    setF('due_date', base.toISOString().split('T')[0])
  }

  const selectedSupplier = parties.find(p => p.id === form.supplier_id)
  const daysLeftInfo = form.due_date ? getDaysLeft(form.due_date, today) : null
  const numericTotal = parseFloat(form.total_amount) || 0

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.title.trim()) { setError('Please enter a title'); return }
    if (!form.supplier_id) { setError('Please select a supplier'); return }
    if (!form.quantity || parseFloat(form.quantity) <= 0) { setError('Please enter a valid quantity'); return }
    if (!form.carat_rate || parseFloat(form.carat_rate) < 0) { setError('Please enter a valid carat rate'); return }
    if (!form.due_date) { setError('Please select a due date'); return }

    setSaving(true)
    setError('')
    try {
      await saveSellingRecord({
        ...existingSelling,
        title: form.title.trim(),
        supplier_id: form.supplier_id,
        quantity: parseFloat(form.quantity),
        carat_rate: parseFloat(form.carat_rate),
        total_amount: numericTotal,
        selling_date: form.selling_date,
        due_date: form.due_date,
        payment_type: form.payment_type,
        remarks: form.remarks.trim() || null,
        payment_id: existingSelling?.payment_id || null,
      }, isEdit)

      onSaved()
    } catch (err) {
      console.error('Error saving selling record:', err)
      setError(err.message || 'Failed to save selling record')
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>{isEdit ? '✏️ Edit Selling' : '💎 Add Selling'}</span>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {error && (
          <div style={{
            background: 'var(--red-bg)', border: '1px solid var(--red-border)',
            color: 'var(--red)', padding: '10px 14px', borderRadius: 'var(--radius-md)',
            marginBottom: 16, fontSize: 13
          }}>
            ⚠️ {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* Title */}
          <div className="form-group">
            <label className="form-label">Title / Description *</label>
            <input
              className="input"
              value={form.title}
              onChange={e => setF('title', e.target.value)}
              placeholder="e.g. CVD Round Polished 0.50-0.70 ct Lot #101"
              required
              autoFocus
            />
          </div>

          {/* Supplier */}
          <div className="form-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label className="form-label">Supplier *</label>
              {selectedSupplier && (
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  Default credit: {selectedSupplier.default_term_days || 90} days
                </span>
              )}
            </div>
            <select
              className="select"
              value={form.supplier_id}
              onChange={e => handleSupplierChange(e.target.value)}
              required
            >
              <option value="">Select a supplier…</option>
              {parties.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* Quantity & Carat Rate */}
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Quantity (Carats) *</label>
              <input
                className="input font-mono"
                type="number"
                step="0.001"
                min="0.001"
                value={form.quantity}
                onChange={e => handleQuantityChange(e.target.value)}
                placeholder="e.g. 15.420"
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Carat Rate (₹ / ct) *</label>
              <input
                className="input font-mono"
                type="number"
                step="0.01"
                min="0"
                value={form.carat_rate}
                onChange={e => handleCaratRateChange(e.target.value)}
                placeholder="e.g. 42000"
                required
              />
            </div>
          </div>

          {/* Automatic Calculated Total Amount */}
          <div style={{
            background: 'var(--blue-bg)',
            border: '1.5px solid var(--blue-border)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 16px',
            marginBottom: 16,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--accent)', letterSpacing: '0.05em' }}>
                ⚡ Automatically Calculated Total
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                {parseFloat(form.quantity) > 0 && parseFloat(form.carat_rate) > 0 ? (
                  `${Number(form.quantity).toFixed(3)} ct × ₹${Number(form.carat_rate).toLocaleString('en-IN')}`
                ) : (
                  'Enter quantity and carat rate above'
                )}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--accent)', fontFamily: 'JetBrains Mono, monospace' }}>
                {formatINR(numericTotal)}
              </div>
            </div>
          </div>

          {/* Dates: Selling Date & Due Date */}
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Selling Date *</label>
              <input
                className="input"
                type="date"
                value={form.selling_date}
                onChange={e => setF('selling_date', e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label className="form-label">Due Date *</label>
                {daysLeftInfo && daysLeftInfo.status !== 'none' && (
                  <span className={`badge ${daysLeftInfo.badgeClass}`} style={{ fontSize: 11 }}>
                    {daysLeftInfo.icon} {daysLeftInfo.text}
                  </span>
                )}
              </div>
              <input
                className="input"
                type="date"
                value={form.due_date}
                onChange={e => setF('due_date', e.target.value)}
                required
              />
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <button type="button" className="btn btn-ghost btn-sm" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => addDaysToDueDate(30)}>+30d</button>
                <button type="button" className="btn btn-ghost btn-sm" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => addDaysToDueDate(60)}>+60d</button>
                <button type="button" className="btn btn-ghost btn-sm" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => addDaysToDueDate(90)}>+90d</button>
                <button type="button" className="btn btn-ghost btn-sm" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => addDaysToDueDate(120)}>+120d</button>
              </div>
            </div>
          </div>

          {/* Switch: Collected Amount vs Adjusted to Balance */}
          <div className="form-group" style={{ marginTop: 8 }}>
            <label className="form-label" style={{ marginBottom: 8 }}>
              Settlement Method Switch *
            </label>
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 10,
              padding: 4,
              background: 'var(--bg-elevated)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border)'
            }}>
              <button
                type="button"
                onClick={() => setF('payment_type', 'collected')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-sm)',
                  border: form.payment_type === 'collected' ? '1.5px solid var(--accent)' : '1px solid transparent',
                  background: form.payment_type === 'collected' ? 'white' : 'transparent',
                  color: form.payment_type === 'collected' ? 'var(--accent)' : 'var(--text-muted)',
                  fontWeight: form.payment_type === 'collected' ? 700 : 500,
                  fontSize: 13,
                  cursor: 'pointer',
                  boxShadow: form.payment_type === 'collected' ? 'var(--shadow-sm)' : 'none',
                  transition: 'all 0.15s ease'
                }}
              >
                <span>💵</span>
                <span>Collected Amount</span>
              </button>

              <button
                type="button"
                onClick={() => setF('payment_type', 'adjusted')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-sm)',
                  border: form.payment_type === 'adjusted' ? '1.5px solid var(--green)' : '1px solid transparent',
                  background: form.payment_type === 'adjusted' ? 'white' : 'transparent',
                  color: form.payment_type === 'adjusted' ? 'var(--green-light)' : 'var(--text-muted)',
                  fontWeight: form.payment_type === 'adjusted' ? 700 : 500,
                  fontSize: 13,
                  cursor: 'pointer',
                  boxShadow: form.payment_type === 'adjusted' ? 'var(--shadow-sm)' : 'none',
                  transition: 'all 0.15s ease'
                }}
              >
                <span>⚖️</span>
                <span>Adjusted to Balance</span>
              </button>
            </div>

            {/* Explanation card based on switch selection */}
            {form.payment_type === 'adjusted' ? (
              <div style={{
                marginTop: 10,
                background: 'var(--green-bg)',
                border: '1px solid var(--green-border)',
                borderRadius: 'var(--radius-md)',
                padding: '10px 14px',
                fontSize: 12.5,
                color: 'var(--green-light)',
                lineHeight: 1.5
              }}>
                <div style={{ fontWeight: 700, marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>⚖️ Auto Payment Entry Enabled</span>
                </div>
                When saved, a payment transaction of <strong>{formatINR(numericTotal)}</strong> will be automatically entered into the <strong>Payments Register</strong> for <strong>{selectedSupplier?.name || 'this supplier'}</strong>. This will settle their open bills via FIFO and reduce what you owe them.
              </div>
            ) : (
              <div style={{
                marginTop: 10,
                background: 'var(--bg-card-hover)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                padding: '10px 14px',
                fontSize: 12.5,
                color: 'var(--text-muted)',
                lineHeight: 1.5
              }}>
                <div style={{ fontWeight: 600, marginBottom: 2 }}>💵 Collected directly from buyer</div>
                Payment is received in cash/bank from the counterparty. Supplier balance and ledger will remain untouched.
              </div>
            )}
          </div>

          {/* Remarks */}
          <div className="form-group">
            <label className="form-label">Remarks / Notes</label>
            <input
              className="input"
              value={form.remarks}
              onChange={e => setF('remarks', e.target.value)}
              placeholder="Optional notes, buyer name, packet reference, etc."
            />
          </div>

          {/* Modal Footer */}
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={saving}
              style={{ minWidth: 140, justifyContent: 'center' }}
            >
              {saving ? 'Saving…' : (isEdit ? 'Update Selling' : '💎 Add Selling')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
