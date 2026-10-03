import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { formatINR } from '../lib/utils'

const emptyLine = (n=1) => ({ line_no: n, unit: 'ct', weight: '', rate: '', qc_return_weight: '' })

export default function InvoiceForm({ invoice: existingInvoice, onClose, onSaved }) {
  const isEdit = !!existingInvoice
  const [parties, setParties] = useState([])
  const [taxRates, setTaxRates] = useState([])
  const [billType, setBillType] = useState(existingInvoice?.bill_type || 'PURCHASE')
  const [form, setForm] = useState({
    party_id:          existingInvoice?.party_id          || '',
    invoice_no:        existingInvoice?.invoice_no        || '',
    invoice_date:      existingInvoice?.invoice_date      || new Date().toISOString().split('T')[0],
    term_days:         existingInvoice?.term_days         ?? 90,
    tax_rate_percent:  existingInvoice?.tax_rate_percent  ?? 1.5,
    round_off:         existingInvoice?.round_off         ?? 0,
    opening_amount:    existingInvoice?.opening_amount    || '',
    remarks:           existingInvoice?.remarks           || '',
  })
  const [lines, setLines] = useState([emptyLine()])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      supabase.from('parties').select('id,name,default_term_days').eq('is_active',true).order('name'),
      supabase.from('tax_rates').select('*').eq('is_active',true).order('rate_percent'),
    ]).then(([{data:p},{data:t}]) => {
      setParties(p||[])
      setTaxRates(t||[])
      if (!isEdit && t?.length && !form.tax_rate_percent) {
        setForm(f=>({...f, tax_rate_percent: t.find(x=>x.is_default)?.rate_percent || t[0].rate_percent}))
      }
    })

    // Load existing lines for edit
    if (isEdit && existingInvoice.bill_type === 'PURCHASE') {
      supabase.from('purchase_invoice_lines').select('*').eq('invoice_id', existingInvoice.id).order('line_no')
        .then(({ data }) => {
          if (data?.length) setLines(data)
        })
    }
  }, [])

  const setF = (k,v) => setForm(f=>({...f,[k]:v}))

  function partyChanged(id) {
    const p = parties.find(x=>x.id===id)
    setF('party_id', id)
    if (p && !isEdit) setF('term_days', p.default_term_days)
  }

  function setLine(i,k,v) {
    setLines(ls => ls.map((l,idx) => idx===i ? {...l,[k]:v} : l))
  }

  function addLine() {
    setLines(ls => [...ls, emptyLine(ls.length+1)])
  }

  function removeLine(i) {
    setLines(ls => ls.filter((_,idx)=>idx!==i).map((l,idx)=>({...l,line_no:idx+1})))
  }

  function calcLineTotal(l) {
    const gross = (Number(l.weight)||0) * (Number(l.rate)||0)
    const qcAmt = (Number(l.qc_return_weight)||0) * (Number(l.rate)||0)
    const taxable = gross - qcAmt
    const tax = taxable * (Number(form.tax_rate_percent)||0) / 100
    return taxable + tax
  }

  const invoiceTotal = billType==='OPENING'
    ? Number(form.opening_amount)||0
    : lines.reduce((s,l) => s+calcLineTotal(l), 0) + Number(form.round_off||0)

  async function save(e) {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      const invoicePayload = {
        party_id:         form.party_id,
        bill_type:        billType,
        invoice_no:       form.invoice_no.trim(),
        invoice_date:     form.invoice_date,
        term_days:        Number(form.term_days),
        tax_rate_percent: billType==='PURCHASE' ? Number(form.tax_rate_percent) : 1.5,
        round_off:        billType==='PURCHASE' ? Number(form.round_off||0) : 0,
        opening_amount:   billType==='OPENING' ? Number(form.opening_amount) : null,
        remarks:          form.remarks || null,
      }

      if (isEdit) {
        const { error: e1 } = await supabase.from('purchase_invoices').update(invoicePayload).eq('id', existingInvoice.id)
        if (e1) throw e1
        if (billType === 'PURCHASE') {
          // Delete old lines and reinsert
          await supabase.from('purchase_invoice_lines').delete().eq('invoice_id', existingInvoice.id)
          const { error: e2 } = await supabase.from('purchase_invoice_lines').insert(
            lines.map((l,i) => ({
              invoice_id: existingInvoice.id,
              line_no: i+1, unit: l.unit||'ct',
              weight: Number(l.weight), rate: Number(l.rate),
              qc_return_weight: Number(l.qc_return_weight)||0,
            }))
          )
          if (e2) throw e2
        }
      } else {
        const { data: inv, error: e1 } = await supabase.from('purchase_invoices').insert(invoicePayload).select('id').single()
        if (e1) throw e1
        if (billType === 'PURCHASE') {
          const { error: e2 } = await supabase.from('purchase_invoice_lines').insert(
            lines.map((l,i) => ({
              invoice_id: inv.id, line_no: i+1, unit: l.unit||'ct',
              weight: Number(l.weight), rate: Number(l.rate),
              qc_return_weight: Number(l.qc_return_weight)||0,
            }))
          )
          if (e2) throw e2
        }
      }
      onSaved()
    } catch (err) {
      setError(err.message || String(err))
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-lg" onClick={e=>e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">{isEdit ? '✏️ Edit Invoice' : '📄 New Invoice'}</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <form id="inv-form" onSubmit={save}>
          {!isEdit && (
            <div className="tabs mb-4" style={{ marginBottom:16, width:'fit-content' }}>
              <button type="button" className={`tab ${billType==='PURCHASE'?'active':''}`} onClick={()=>setBillType('PURCHASE')}>Purchase Bill</button>
              <button type="button" className={`tab ${billType==='OPENING'?'active':''}`} onClick={()=>setBillType('OPENING')}>Opening Balance</button>
            </div>
          )}

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Supplier *</label>
              <select className="select" value={form.party_id} onChange={e=>partyChanged(e.target.value)} required>
                <option value="">Select supplier…</option>
                {parties.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Invoice No *</label>
              <input className="input" value={form.invoice_no} onChange={e=>setF('invoice_no',e.target.value)} required placeholder="e.g. INV-001" />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Invoice Date *</label>
              <input className="input" type="date" value={form.invoice_date} onChange={e=>setF('invoice_date',e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label">Credit Term (days)</label>
              <input className="input" type="number" min={0} value={form.term_days} onChange={e=>setF('term_days',e.target.value)} />
            </div>
          </div>

          {billType==='OPENING' ? (
            <div className="form-group">
              <label className="form-label">Opening Amount (₹) *</label>
              <input className="input" type="number" min="0.01" step="0.01" value={form.opening_amount} onChange={e=>setF('opening_amount',e.target.value)} required style={{ fontSize:18, fontWeight:700 }} />
            </div>
          ) : (
            <>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Tax Rate</label>
                  <select className="select" value={form.tax_rate_percent} onChange={e=>setF('tax_rate_percent',e.target.value)}>
                    {taxRates.map(t=><option key={t.id} value={t.rate_percent}>{t.name} ({t.rate_percent}%)</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Round Off (₹)</label>
                  <input className="input" type="number" step="0.01" value={form.round_off} onChange={e=>setF('round_off',e.target.value)} />
                </div>
              </div>

              {/* Lines */}
              <div style={{ marginBottom:14 }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
                  <div className="form-label" style={{ margin:0, fontSize:13, fontWeight:700 }}>Invoice Lines</div>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={addLine}>+ Add Line</button>
                </div>
                {lines.map((l,i) => (
                  <div key={i} style={{ display:'grid', gridTemplateColumns:'30px 1fr 1fr 1fr 90px', gap:8, alignItems:'end', marginBottom:8, background:'var(--bg-elevated)', borderRadius:'var(--radius-sm)', padding:'10px 12px', border:'1px solid var(--border)' }}>
                    <div style={{ fontSize:12, color:'var(--text-muted)', fontWeight:700, paddingBottom:4 }}>#{i+1}</div>
                    <div>
                      <div className="form-label">Weight (ct)</div>
                      <input className="input" type="number" step="0.001" min="0.001" value={l.weight} onChange={e=>setLine(i,'weight',e.target.value)} required placeholder="0.000" />
                    </div>
                    <div>
                      <div className="form-label">Rate (₹/ct)</div>
                      <input className="input" type="number" step="0.01" min="0" value={l.rate} onChange={e=>setLine(i,'rate',e.target.value)} required placeholder="40000" />
                    </div>
                    <div>
                      <div className="form-label">QC Return (ct)</div>
                      <input className="input" type="number" step="0.001" min="0" value={l.qc_return_weight} onChange={e=>setLine(i,'qc_return_weight',e.target.value)} placeholder="0" />
                    </div>
                    <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4, paddingBottom:2 }}>
                      <div style={{ fontSize:11, color:'var(--text-muted)' }}>Line Total</div>
                      <div style={{ fontSize:13, fontWeight:800, color:'var(--accent)' }}>{formatINR(calcLineTotal(l))}</div>
                      {lines.length>1 && <button type="button" onClick={()=>removeLine(i)} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--red)', fontSize:16, padding:'0 2px' }}>✕</button>}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="form-group">
            <label className="form-label">Remarks</label>
            <input className="input" value={form.remarks} onChange={e=>setF('remarks',e.target.value)} placeholder="Optional note" />
          </div>

          {/* Total */}
          <div style={{ background:'var(--blue-bg)', border:'2px solid var(--blue-border)', borderRadius:'var(--radius-md)', padding:'14px 18px', display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:8 }}>
            <span style={{ fontSize:13, fontWeight:700, color:'var(--text-muted)' }}>NET PAYABLE</span>
            <span style={{ fontSize:24, fontWeight:900, color:'var(--accent)' }}>{formatINR(invoiceTotal)}</span>
          </div>
        </form>

        {error && <div style={{ color:'var(--red)', fontSize:12, marginTop:10 }}>{error}</div>}
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" form="inv-form" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : isEdit ? '✏️ Update Invoice' : '💾 Save Invoice'}
          </button>
        </div>
      </div>
    </div>
  )
}
