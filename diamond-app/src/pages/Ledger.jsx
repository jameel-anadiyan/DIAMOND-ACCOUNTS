import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { formatINR, formatDate } from '../lib/utils'

export default function Ledger() {
  const [parties, setParties] = useState([])
  const [partyId, setPartyId] = useState('')
  const [ledger, setLedger] = useState([])
  const [loading, setLoading] = useState(false)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState(new Date().toISOString().split('T')[0])

  useEffect(() => {
    supabase.from('parties').select('id,name').eq('is_active', true).order('name')
      .then(({ data }) => setParties(data || []))
  }, [])

  useEffect(() => {
    if (partyId) load()
  }, [partyId, fromDate, toDate])

  async function load() {
    setLoading(true)
    const { data } = await supabase.rpc('fn_party_ledger', {
      p_party_id: partyId,
      p_from: fromDate || null,
      p_to: toDate || undefined,
    })
    setLedger(data || [])
    setLoading(false)
  }

  const currentBalance = ledger.length > 0 ? ledger[ledger.length - 1].running_balance : 0

  return (
    <div>
      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 800 }}>Ledger</h1>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>Party account statement</div>
          </div>
        </div>
      </div>

      <div className="page-body">
        <div className="flex gap-3 mb-4" style={{ marginBottom: 20, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <label className="form-label">Supplier</label>
            <select className="select" value={partyId} onChange={e => setPartyId(e.target.value)}>
              <option value="">Select supplier…</option>
              {parties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label">From Date</label>
            <input className="input" type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} />
          </div>
          <div>
            <label className="form-label">To Date</label>
            <input className="input" type="date" value={toDate} onChange={e => setToDate(e.target.value)} />
          </div>
        </div>

        {!partyId && (
          <div className="empty-state">
            <div className="empty-icon">📒</div>
            <p>Select a supplier to view their ledger</p>
          </div>
        )}

        {partyId && loading && <div className="spinner-wrap"><div className="spinner" /></div>}

        {partyId && !loading && ledger.length > 0 && (
          <>
            <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
              <div className="kpi-card" style={{ padding: '14px 18px' }}>
                <div className="kpi-label">Closing Balance</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: currentBalance > 0 ? 'var(--red)' : 'var(--green)', marginTop: 6 }}>
                  {formatINR(currentBalance)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  {currentBalance > 0 ? 'You owe this supplier' : currentBalance < 0 ? 'Advance / overpaid' : 'Fully settled ✅'}
                </div>
              </div>
              <div className="kpi-card" style={{ padding: '14px 18px' }}>
                <div className="kpi-label">Total Billed</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', marginTop: 6 }}>
                  {formatINR(ledger.reduce((s, l) => s + Number(l.bill_amount || 0), 0))}
                </div>
              </div>
              <div className="kpi-card" style={{ padding: '14px 18px' }}>
                <div className="kpi-label">Total Paid</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--green)', marginTop: 6 }}>
                  {formatINR(ledger.reduce((s, l) => s + Number(l.paid_amount || 0), 0))}
                </div>
              </div>
              <div className="kpi-card" style={{ padding: '14px 18px' }}>
                <div className="kpi-label">Entries</div>
                <div style={{ fontSize: 22, fontWeight: 800, marginTop: 6 }}>{ledger.length}</div>
              </div>
            </div>

            <div className="table-wrapper">
              <div className="table-header">
                <div className="table-title">📒 Account Statement – {parties.find(p=>p.id===partyId)?.name}</div>
                <button className="btn btn-ghost btn-sm" onClick={() => window.print()}>🖨️ Print</button>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Ref No</th>
                      <th>Particulars</th>
                      <th className="td-right">Bill Amount</th>
                      <th className="td-right">Paid Amount</th>
                      <th className="td-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.map(l => (
                      <tr key={l.line_no} className={l.entry_type === 'B/F' ? 'ledger-bf' : ''}>
                        <td className="text-muted">{l.line_no}</td>
                        <td>{formatDate(l.entry_date)}</td>
                        <td>
                          <span className={`badge ${
                            l.entry_type === 'BILL' ? 'badge-red' :
                            l.entry_type === 'PAYMENT' ? 'badge-green' :
                            l.entry_type === 'OPENING' ? 'badge-yellow' : 'badge-blue'
                          }`} style={{ fontSize: 10 }}>{l.entry_type}</span>
                        </td>
                        <td className="td-mono" style={{ fontSize: 11 }}>{l.ref_no || '—'}</td>
                        <td style={{ fontSize: 12, color: 'var(--text-secondary)', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {l.particulars}
                        </td>
                        <td className="td-right td-mono" style={{ color: l.bill_amount > 0 ? 'var(--red)' : 'var(--text-muted)' }}>
                          {l.bill_amount > 0 ? formatINR(l.bill_amount) : '—'}
                        </td>
                        <td className="td-right td-mono" style={{ color: l.paid_amount > 0 ? 'var(--green)' : 'var(--text-muted)' }}>
                          {l.paid_amount > 0 ? formatINR(l.paid_amount) : '—'}
                        </td>
                        <td className="td-right">
                          <span className={`ledger-balance ${Number(l.running_balance) > 0 ? 'positive' : 'zero'}`}>
                            {formatINR(l.running_balance)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: 'var(--bg-elevated)', borderTop: '2px solid var(--border)' }}>
                      <td colSpan={5} style={{ fontWeight: 700, padding: '12px 14px' }}>CLOSING BALANCE</td>
                      <td className="td-right td-mono" style={{ fontWeight: 700 }}>
                        {formatINR(ledger.reduce((s, l) => s + Number(l.bill_amount || 0), 0))}
                      </td>
                      <td className="td-right td-mono" style={{ fontWeight: 700, color: 'var(--green)' }}>
                        {formatINR(ledger.reduce((s, l) => s + Number(l.paid_amount || 0), 0))}
                      </td>
                      <td className="td-right">
                        <span style={{ fontWeight: 800, fontSize: 15, color: currentBalance > 0 ? 'var(--red)' : 'var(--green)' }}>
                          {formatINR(currentBalance)}
                        </span>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </>
        )}

        {partyId && !loading && ledger.length === 0 && (
          <div className="empty-state"><div className="empty-icon">📒</div><p>No ledger entries for selected period</p></div>
        )}
      </div>
    </div>
  )
}
