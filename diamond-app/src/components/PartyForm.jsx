import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function PartyForm({ party, onClose, onSaved }) {
  const isEdit = !!party?.party_id
  const [brokers, setBrokers] = useState([])
  const [form, setForm] = useState({
    name:              party?.party_name || '',
    contact_person:    party?.contact_person || '',
    phone:             party?.phone || '',
    alt_phone:         party?.alt_phone || '',
    email:             party?.email || '',
    address:           party?.address || '',
    city:              party?.city || '',
    gstin:             party?.gstin || '',
    pan:               party?.pan || '',
    default_term_days: party?.default_term_days ?? 90,
    remarks:           party?.remarks || '',
    broker_id:         party?.broker_id || '',
    is_active:         party?.is_active ?? true,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.from('brokers').select('id,name').eq('is_active', true).order('name')
      .then(({ data }) => setBrokers(data || []))
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function save(e) {
    e.preventDefault()
    setSaving(true); setError('')
    const payload = {
      name:              form.name.trim(),
      contact_person:    form.contact_person || null,
      phone:             form.phone || null,
      alt_phone:         form.alt_phone || null,
      email:             form.email || null,
      address:           form.address || null,
      city:              form.city || null,
      gstin:             form.gstin || null,
      pan:               form.pan || null,
      default_term_days: Number(form.default_term_days),
      remarks:           form.remarks || null,
      broker_id:         form.broker_id || null,
      is_active:         form.is_active,
    }
    const { error: err } = isEdit
      ? await supabase.from('parties').update(payload).eq('id', party.party_id)
      : await supabase.from('parties').insert(payload)
    if (err) { setError(err.message); setSaving(false); return }
    onSaved()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">{isEdit ? '✏️ Edit Supplier' : '🏢 Add Supplier'}</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={save}>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Supplier Name *</label>
              <input className="input" value={form.name} onChange={e=>set('name',e.target.value)} required placeholder="e.g. ABC DIAMONDS" />
            </div>
            <div className="form-group">
              <label className="form-label">Contact Person</label>
              <input className="input" value={form.contact_person} onChange={e=>set('contact_person',e.target.value)} placeholder="Name" />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Phone</label>
              <input className="input" value={form.phone} onChange={e=>set('phone',e.target.value)} placeholder="Mobile number" />
            </div>
            <div className="form-group">
              <label className="form-label">Alt Phone</label>
              <input className="input" value={form.alt_phone} onChange={e=>set('alt_phone',e.target.value)} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">City</label>
              <input className="input" value={form.city} onChange={e=>set('city',e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Broker / C.O.</label>
              <select className="select" value={form.broker_id} onChange={e=>set('broker_id',e.target.value)}>
                <option value="">None (Direct)</option>
                {brokers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Credit Term (days)</label>
              <input className="input" type="number" min={0} value={form.default_term_days} onChange={e=>set('default_term_days',e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">GSTIN</label>
              <input className="input" value={form.gstin} onChange={e=>set('gstin',e.target.value.toUpperCase())} placeholder="22AAAAA0000A1Z5" />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Address</label>
            <textarea className="input" rows={2} value={form.address} onChange={e=>set('address',e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Remarks / Notes</label>
            <input className="input" value={form.remarks} onChange={e=>set('remarks',e.target.value)} />
          </div>
          {isEdit && (
            <div className="form-group" style={{ display:'flex', alignItems:'center', gap:10 }}>
              <input type="checkbox" id="is_active" checked={form.is_active} onChange={e=>set('is_active',e.target.checked)} style={{ width:16, height:16, cursor:'pointer' }} />
              <label htmlFor="is_active" className="form-label" style={{ margin:0, cursor:'pointer' }}>Active (uncheck to deactivate)</label>
            </div>
          )}
          {error && <div style={{ color:'var(--red)', fontSize:12, marginBottom:10 }}>{error}</div>}
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : isEdit ? '✏️ Update Supplier' : '✅ Add Supplier'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
