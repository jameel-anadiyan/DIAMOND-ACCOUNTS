import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { formatINR, formatWeight, getDaysLeft } from '../lib/utils'
import { saveSellingRecord } from '../lib/sellingService'

const emptyLine = (n = 1) => ({
  line_no: n,
  description: '',
  quantity: '',
  carat_rate: '',
  amount: '',
})

export default function SellingForm({ selling: existingSelling, onClose, onSaved }) {
  const isEdit = !!existingSelling
  const today = new Date().toISOString().split('T')[0]

  const [parties, setParties] = useState([])
  const [form, setForm] = useState({
    title:        existingSelling?.title        || '',
    supplier_id:  existingSelling?.supplier_id  || '',
    selling_date: existingSelling?.selling_date || today,
    due_date:     existingSelling?.due_date     || '',
    remarks:      existingSelling?.remarks      || '',
  })

  // Multiple quantity / line items
  const [lines, setLines] = useState(() => {
    if (existingSelling?.lines && existingSelling.lines.length > 0) {
      return existingSelling.lines.map((l, i) => ({
        line_no: i + 1,
        description: l.description || '',
        quantity: l.quantity ?? '',
        carat_rate: l.carat_rate ?? '',
        amount: l.amount ?? ((parseFloat(l.quantity) || 0) * (parseFloat(l.carat_rate) || 0)).toFixed(2),
      }))
    }
    if (existingSelling?.quantity) {
      const q = parseFloat(existingSelling.quantity) || ''
      const r = parseFloat(existingSelling.carat_rate) || ''
      const amt = existingSelling.total_amount ?? ((parseFloat(q) || 0) * (parseFloat(r) || 0)).toFixed(2)
      return [{ line_no: 1, description: '', quantity: q, carat_rate: r, amount: amt }]
    }
    return [emptyLine(1)]
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

  function handleSupplierChange(id) {
    setF('supplier_id', id)
    const p = parties.find(x => x.id === id)
    if (p && !form.due_date) {
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

  // Line helpers
  function setLineField(idx, key, val) {
    setLines(prev => prev.map((line, i) => {
      if (i !== idx) return line
      const updated = { ...line, [key]: val }
      if (key === 'quantity' || key === 'carat_rate') {
        const q = parseFloat(key === 'quantity' ? val : updated.quantity) || 0
        const r = parseFloat(key === 'carat_rate' ? val : updated.carat_rate) || 0
        updated.amount = q > 0 && r > 0 ? (q * r).toFixed(2) : (val === '' ? '' : updated.amount)
      }
      return updated
    }))
  }

  function addLine() {
    setLines(prev => [...prev, emptyLine(prev.length + 1)])
  }

  function removeLine(idx) {
    if (lines.length <= 1) return
    setLines(prev => prev.filter((_, i) => i !== idx).map((l, i) => ({ ...l, line_no: i + 1 })))
  }

  // Calculate totals across all lines
  const totalQuantity = lines.reduce((s, l) => s + (parseFloat(l.quantity) || 0), 0)
  const totalAmount = lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0)

  const selectedSupplier = parties.find(p => p.id === form.supplier_id)
  const daysLeftInfo = form.due_date ? getDaysLeft(form.due_date, today) : null

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.title.trim()) { setError('Please enter a title / description'); return }
    if (!form.supplier_id) { setError('Please select a supplier'); return }
    if (!form.due_date) { setError('Please select a due date'); return }

    // Validate that at least one line has valid quantity and rate
    const validLines = lines.filter(l => parseFloat(l.quantity) > 0 && parseFloat(l.carat_rate) >= 0)
    if (validLines.length === 0) {
      setError('Please add at least one item/lot with a valid quantity (carats) and carat rate')
      return
    }

    setSaving(true)
    setError('')
    try {
      await saveSellingRecord({
        ...existingSelling,
        title: form.title.trim(),
        supplier_id: form.supplier_id,
        selling_date: form.selling_date,
        due_date: form.due_date,
        lines: validLines.map((l, i) => ({
          line_no: i + 1,
          description: l.description.trim(),
          quantity: parseFloat(l.quantity),
          carat_rate: parseFloat(l.carat_rate),
          amount: parseFloat(l.amount) || Number((parseFloat(l.quantity) * parseFloat(l.carat_rate)).toFixed(2)),
        })),
        quantity: totalQuantity,
        carat_rate: totalQuantity > 0 ? Number((totalAmount / totalQuantity).toFixed(2)) : 0,
        total_amount: totalAmount,
        remarks: form.remarks.trim() || null,
        payment_status: existingSelling?.payment_status || 'unpaid',
        payment_type: existingSelling?.payment_type || null,
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
      <div className="modal modal-xl" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>{isEdit ? '✏️ Edit Selling Order' : '💎 Record New Sale'}</span>
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
          {/* Header Details: Title & Supplier */}
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Sale Title / Lot Description *</label>
              <input
                className="input"
                value={form.title}
                onChange={e => setF('title', e.target.value)}
                placeholder="e.g. CVD Round Polished 0.50-0.70 ct Lot #101"
                required
                autoFocus
              />
            </div>
            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label className="form-label">Supplier *</label>
                {selectedSupplier && (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    Credit: {selectedSupplier.default_term_days || 90}d
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
          </div>

          {/* Dates: Selling Date & Due Date */}
          <div className="form-row" style={{ marginBottom: 18 }}>
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

          {/* Multiple Quantities / Items Table */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-secondary)' }}>
                💎 Items / Quantity Lots ({lines.length})
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={addLine}
                style={{ color: 'var(--accent)', fontWeight: 600, padding: '4px 10px' }}
              >
                + Add Another Item
              </button>
            </div>

            <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-card)', borderBottom: '1px solid var(--border)' }}>
                    <th style={{ width: 36, textAlign: 'center', padding: '8px 6px' }}>#</th>
                    <th style={{ padding: '8px 10px' }}>Lot / Description (Optional)</th>
                    <th style={{ width: 140, padding: '8px 10px' }}>Weight (ct) *</th>
                    <th style={{ width: 150, padding: '8px 10px' }}>Carat Rate (₹) *</th>
                    <th style={{ width: 160, textAlign: 'right', padding: '8px 12px' }}>Line Total (₹)</th>
                    <th style={{ width: 44, textAlign: 'center', padding: '8px 6px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, idx) => (
                    <tr key={idx} style={{ borderBottom: idx < lines.length - 1 ? '1px solid var(--border)' : 'none', background: 'white' }}>
                      <td style={{ textAlign: 'center', fontWeight: 600, color: 'var(--text-muted)' }}>
                        {idx + 1}
                      </td>
                      <td style={{ padding: '6px 8px' }}>
                        <input
                          className="input"
                          style={{ padding: '6px 10px', fontSize: 13 }}
                          placeholder={`Item #${idx + 1} description`}
                          value={l.description}
                          onChange={e => setLineField(idx, 'description', e.target.value)}
                        />
                      </td>
                      <td style={{ padding: '6px 8px' }}>
                        <input
                          className="input font-mono"
                          type="number"
                          step="0.001"
                          min="0.001"
                          style={{ padding: '6px 10px', fontSize: 13 }}
                          placeholder="e.g. 10.500"
                          value={l.quantity}
                          onChange={e => setLineField(idx, 'quantity', e.target.value)}
                          required
                        />
                      </td>
                      <td style={{ padding: '6px 8px' }}>
                        <input
                          className="input font-mono"
                          type="number"
                          step="0.01"
                          min="0"
                          style={{ padding: '6px 10px', fontSize: 13 }}
                          placeholder="e.g. 42000"
                          value={l.carat_rate}
                          onChange={e => setLineField(idx, 'carat_rate', e.target.value)}
                          required
                        />
                      </td>
                      <td style={{ textAlign: 'right', padding: '6px 12px', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color: 'var(--green-light)', fontSize: 14 }}>
                        {formatINR(parseFloat(l.amount) || 0)}
                      </td>
                      <td style={{ textAlign: 'center', padding: '6px 4px' }}>
                        {lines.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeLine(idx)}
                            title="Remove lot line"
                            style={{
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              color: 'var(--red)',
                              fontSize: 14,
                              padding: 4,
                            }}
                          >
                            ✕
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Live Automatic Calculation Card */}
          <div style={{
            background: 'var(--blue-bg)',
            border: '1.5px solid var(--blue-border)',
            borderRadius: 'var(--radius-md)',
            padding: '14px 18px',
            marginBottom: 18,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 12
          }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--accent)', letterSpacing: '0.05em' }}>
                ⚡ Auto-Calculated Sale Summary
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 3 }}>
                <strong>{lines.length} {lines.length === 1 ? 'lot' : 'lots'}</strong> · Total Weight: <strong style={{ color: 'var(--accent)' }}>{formatWeight(totalQuantity)}</strong>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
                Total Sale Amount
              </div>
              <div style={{ fontSize: 24, fontWeight: 900, color: 'var(--accent)', fontFamily: 'JetBrains Mono, monospace' }}>
                {formatINR(totalAmount)}
              </div>
            </div>
          </div>

          {/* Remarks */}
          <div className="form-group" style={{ marginBottom: 20 }}>
            <label className="form-label">Remarks / Buyer Notes</label>
            <input
              className="input"
              value={form.remarks}
              onChange={e => setF('remarks', e.target.value)}
              placeholder="Optional notes, buyer name, packet reference, etc."
            />
          </div>

          {/* Notice info on payment */}
          <div style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: '10px 14px',
            fontSize: 12,
            color: 'var(--text-muted)',
            marginBottom: 20
          }}>
            💡 <strong>Payment Settlement</strong>: Saved as Unpaid. You can mark it as <strong>Collected</strong> or <strong>Adjusted to Supplier Balance</strong> at any time using the switch in the Selling Portal.
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
              style={{ minWidth: 140, justifyContent: 'center', fontWeight: 700 }}
            >
              {saving ? 'Saving…' : (isEdit ? 'Update Sale' : '💎 Save Selling Order')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
