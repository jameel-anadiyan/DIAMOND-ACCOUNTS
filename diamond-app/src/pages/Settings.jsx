import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function Settings() {
  const [settings, setSettings] = useState(null)
  const [modes, setModes] = useState([])
  const [brokers, setBrokers] = useState([])
  const [taxRates, setTaxRates] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [tab, setTab] = useState('general')

  // WhatsApp number from localStorage
  const [waNumber, setWaNumber] = useState(localStorage.getItem('wa_number') || '917012677687')
  const [waSaved, setWaSaved] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [{ data: s }, { data: m }, { data: b }, { data: t }] = await Promise.all([
      supabase.from('app_settings').select('*').eq('id', 1).single(),
      supabase.from('payment_modes').select('*').order('sort_order'),
      supabase.from('brokers').select('*').order('name'),
      supabase.from('tax_rates').select('*').order('rate_percent'),
    ])
    setSettings(s)
    setModes(m || [])
    setBrokers(b || [])
    setTaxRates(t || [])
    setLoading(false)
  }

  async function saveSettings(e) {
    e.preventDefault()
    setSaving(true)
    const { error } = await supabase.from('app_settings').update({
      recent_payment_days: Number(settings.recent_payment_days),
      due_soon_days: Number(settings.due_soon_days),
      overdue_tolerance: Number(settings.overdue_tolerance),
      red_tier1_max_days: Number(settings.red_tier1_max_days),
      red_tier2_max_days: Number(settings.red_tier2_max_days),
      red_tier3_max_days: Number(settings.red_tier3_max_days),
      today_override: settings.today_override || null,
    }).eq('id', 1)
    setSaving(false)
    if (!error) { setSaved(true); setTimeout(() => setSaved(false), 2500) }
  }

  function saveWaNumber() {
    const clean = waNumber.replace(/\D/g, '')
    localStorage.setItem('wa_number', clean)
    setWaSaved(true)
    setTimeout(() => setWaSaved(false), 2500)
  }

  if (loading) return <div className="spinner-wrap"><div className="spinner" /></div>

  return (
    <div>
      <div className="page-header">
        <h1 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)' }}>Settings</h1>
      </div>
      <div className="page-body">
        <div className="tabs mb-4" style={{ marginBottom: 20, width: 'fit-content' }}>
          {[['general','⚙️ General'],['whatsapp','📲 WhatsApp'],['modes','💳 Modes'],['brokers','👤 Brokers'],['tax','🧾 Tax']].map(([id,l]) => (
            <button key={id} className={`tab ${tab===id?'active':''}`} onClick={() => setTab(id)}>{l}</button>
          ))}
        </div>

        {/* ── WhatsApp Tab ──────────────────── */}
        {tab === 'whatsapp' && (
          <div className="card" style={{ maxWidth: 480 }}>
            <div className="section-title">📲 WhatsApp Receipt Number</div>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 18, lineHeight: 1.6 }}>
              After recording a payment, a receipt can be sent directly to WhatsApp. Enter the number (with country code) that should receive the receipts.
            </p>

            <div style={{ background: 'var(--blue-bg)', border: '1px solid var(--blue-border)', borderRadius: 'var(--radius-md)', padding: '12px 16px', marginBottom: 18 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', marginBottom: 6 }}>CURRENT NUMBER</div>
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 18, fontWeight: 800, color: 'var(--text-primary)' }}>
                +{localStorage.getItem('wa_number') || '917012677687'}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">WhatsApp Number (with country code, no + or spaces)</label>
              <input
                className="input"
                type="tel"
                value={waNumber}
                onChange={e => setWaNumber(e.target.value)}
                placeholder="e.g. 917012677687"
                style={{ fontSize: 16, fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}
              />
              <div className="form-hint">India (+91): start with 91. Example: 917012677687</div>
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
              <button
                className="btn btn-whatsapp"
                onClick={saveWaNumber}
              >
                {waSaved ? '✅ Saved!' : '💾 Save Number'}
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => window.open(`https://wa.me/${waNumber}?text=Hello+Diamond+Accounts+test`, '_blank')}
              >
                📲 Test WhatsApp
              </button>
            </div>
          </div>
        )}

        {/* ── General Tab ──────────────────── */}
        {tab === 'general' && settings && (
          <form onSubmit={saveSettings}>
            <div className="card" style={{ maxWidth: 580 }}>
              <div className="section-title">Aging & Alert Thresholds</div>

              <div style={{ background: 'var(--yellow-bg)', border: '1px solid var(--yellow-border)', borderRadius: 'var(--radius-md)', padding: '12px 14px', marginBottom: 18, fontSize: 12.5, color: 'var(--yellow-light)', lineHeight: 1.7 }}>
                🟡 <strong>YELLOW</strong>: Overdue but payment made within <strong>{settings.recent_payment_days}</strong> days<br />
                🔴 <strong>RED</strong>: Overdue + no recent payment, escalates by days
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Recent Payment Window (days)</label>
                  <input className="input" type="number" min={1}
                    value={settings.recent_payment_days}
                    onChange={e => setSettings(s => ({ ...s, recent_payment_days: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Due Soon Window (days)</label>
                  <input className="input" type="number" min={1}
                    value={settings.due_soon_days}
                    onChange={e => setSettings(s => ({ ...s, due_soon_days: e.target.value }))} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Overdue Tolerance (₹)</label>
                <input className="input" type="number" min={0}
                  value={settings.overdue_tolerance}
                  onChange={e => setSettings(s => ({ ...s, overdue_tolerance: e.target.value }))} />
                <div className="form-hint">Amounts under this are treated as fully cleared</div>
              </div>

              <div className="divider" />
              <div className="section-title" style={{ fontSize: 13 }}>Red Tier Escalation</div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Tier 1 — max days (Mild)</label>
                  <input className="input" type="number" value={settings.red_tier1_max_days}
                    onChange={e => setSettings(s => ({ ...s, red_tier1_max_days: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Tier 2 — max days (Serious)</label>
                  <input className="input" type="number" value={settings.red_tier2_max_days}
                    onChange={e => setSettings(s => ({ ...s, red_tier2_max_days: e.target.value }))} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Tier 3 — max days (Severe)</label>
                  <input className="input" type="number" value={settings.red_tier3_max_days}
                    onChange={e => setSettings(s => ({ ...s, red_tier3_max_days: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Today Override (for testing)</label>
                  <input className="input" type="date"
                    value={settings.today_override || ''}
                    onChange={e => setSettings(s => ({ ...s, today_override: e.target.value || null }))} />
                  <div className="form-hint" style={{ color: 'var(--yellow-light)' }}>Leave blank to use real today</div>
                </div>
              </div>

              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saved ? '✅ Saved!' : saving ? 'Saving…' : '💾 Save Settings'}
              </button>
            </div>
          </form>
        )}

        {tab === 'modes' && (
          <div className="table-wrapper" style={{ maxWidth: 600 }}>
            <div className="table-header"><div className="table-title">Payment Modes</div></div>
            <table>
              <thead><tr><th>Name</th><th>Counts as Payment</th><th>Needs Reference</th><th>Active</th></tr></thead>
              <tbody>
                {modes.map(m => (
                  <tr key={m.id}>
                    <td className="td-primary">{m.name}</td>
                    <td>{m.counts_as_payment ? <span className="badge badge-green">Yes</span> : '—'}</td>
                    <td>{m.needs_reference ? <span className="badge badge-blue">Yes</span> : '—'}</td>
                    <td>{m.is_active ? <span className="badge badge-green">Active</span> : <span className="badge badge-red">Off</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'brokers' && (
          <div className="table-wrapper" style={{ maxWidth: 520 }}>
            <div className="table-header"><div className="table-title">Brokers / C.O.</div></div>
            <table>
              <thead><tr><th>Name</th><th>Phone</th><th>Active</th></tr></thead>
              <tbody>
                {brokers.map(b => (
                  <tr key={b.id}>
                    <td className="td-primary">{b.name}</td>
                    <td>{b.phone || '—'}</td>
                    <td>{b.is_active ? <span className="badge badge-green">Active</span> : <span className="badge badge-red">Off</span>}</td>
                  </tr>
                ))}
                {brokers.length === 0 && <tr><td colSpan={3} className="text-muted" style={{ textAlign: 'center', padding: 24 }}>No brokers yet</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'tax' && (
          <div className="table-wrapper" style={{ maxWidth: 400 }}>
            <div className="table-header"><div className="table-title">Tax Rates</div></div>
            <table>
              <thead><tr><th>Name</th><th>Rate %</th><th>Default</th></tr></thead>
              <tbody>
                {taxRates.map(t => (
                  <tr key={t.id}>
                    <td className="td-primary">{t.name}</td>
                    <td className="td-mono">{t.rate_percent}%</td>
                    <td>{t.is_default ? '⭐ Default' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
