import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { formatINR, formatDate, formatWeight, flagIcon } from '../lib/utils'
import PaymentForm from './PaymentForm'
import PartyForm from './PartyForm'
import PaymentReceipt from './PaymentReceipt'
import DoubleConfirm from './DoubleConfirm'

export default function PartyDetail({ party, onBack, onReload }) {
  const [summary, setSummary] = useState(party)
  const [bills, setBills] = useState([])
  const [ledger, setLedger] = useState([])
  const [payments, setPayments] = useState([])
  const [tab, setTab] = useState('bills')
  const [loading, setLoading] = useState(true)
  const [showPayForm, setShowPayForm] = useState(false)
  const [showEditForm, setShowEditForm] = useState(false)
  const [receiptPayment, setReceiptPayment] = useState(null)
  const [confirmDeactivate, setConfirmDeactivate] = useState(false)
  const [deactivating, setDeactivating] = useState(false)
  const [editPayment, setEditPayment] = useState(null)
  const [deletePayment, setDeletePayment] = useState(null)
  const [deletingPay, setDeletingPay] = useState(false)

  useEffect(() => { load() }, [party.party_id])

  async function load() {
    setLoading(true)
    const today = new Date().toISOString().split('T')[0]
    const [{ data: s }, { data: b }, { data: p }] = await Promise.all([
      supabase.rpc('fn_party_summary', { p_as_of: today }),
      supabase.rpc('fn_bill_status', { p_as_of: today }),
      supabase.from('party_payments')
        .select('*, mode:payment_modes(id,name,counts_as_payment,needs_reference)')
        .eq('party_id', party.party_id)
        .order('payment_date', { ascending: false }),
    ])
    setSummary((s||[]).find(x => x.party_id === party.party_id) || party)
    setBills((b||[]).filter(x => x.party_id === party.party_id))
    setPayments((p||[]).map(pp => ({ ...pp, mode_name: pp.mode?.name, is_scheduled: pp.payment_date > today })))

    const { data: l } = await supabase.rpc('fn_party_ledger', { p_party_id: party.party_id })
    setLedger(l || [])
    setLoading(false)
  }

  async function deactivate() {
    setDeactivating(true)
    await supabase.from('parties').update({ is_active: false }).eq('id', party.party_id)
    setDeactivating(false)
    setConfirmDeactivate(false)
    onBack()
    onReload?.()
  }

  async function deletePaymentEntry() {
    setDeletingPay(true)
    await supabase.from('party_payments').delete().eq('id', deletePayment.id)
    setDeletingPay(false)
    setDeletePayment(null)
    load()
  }

  const s = summary

  return (
    <div>
      {/* ── Header with Back ── */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ gap: 6 }}>
            ← Back
          </button>
          <div style={{ width: 1, height: 20, background: 'var(--border)' }} />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)' }}>{s.party_name}</span>
              <span className={`flag-badge flag-${s.flag}`}>{flagIcon(s.flag)} {s.flag_label}</span>
            </div>
            {s.broker_name && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>via {s.broker_name}</div>}
          </div>
          <div style={{ flex: 1 }} />
          <button className="btn btn-primary btn-sm" onClick={() => setShowPayForm(true)}>💳 Record Payment</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowEditForm(true)}>✏️ Edit</button>
          <button
            className="btn btn-sm"
            style={{ background: 'var(--red-bg)', color: 'var(--red)', border: '1px solid var(--red-border)' }}
            onClick={() => setConfirmDeactivate(true)}
          >🗑️ Deactivate</button>
        </div>
      </div>

      <div className="page-body">
        {/* Flag reason */}
        {s.flag_reason && (
          <div style={{ marginBottom: 16, padding: '10px 14px', background: s.flag==='RED'?'var(--red-bg)':s.flag==='YELLOW'?'var(--yellow-bg)':'var(--green-bg)', border: `1px solid ${s.flag==='RED'?'var(--red-border)':s.flag==='YELLOW'?'var(--yellow-border)':'var(--green-border)'}`, borderRadius: 'var(--radius-md)', fontSize: 13, color: s.flag==='RED'?'var(--red)':s.flag==='YELLOW'?'var(--yellow-light)':'var(--green)', fontWeight: 500 }}>
            {s.flag_reason}
          </div>
        )}

        {/* KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 12, marginBottom: 20 }}>
          {[
            { label: 'Total Payable', value: formatINR(s.total_payable), color: 'var(--text-primary)' },
            { label: 'Total Paid',    value: formatINR(s.total_paid),    color: 'var(--green)' },
            { label: 'Outstanding',   value: formatINR(s.outstanding),   color: s.outstanding>0?'var(--yellow)':'var(--green)' },
            { label: 'Overdue',       value: formatINR(s.overdue_amount),color: s.overdue_amount>0?'var(--red)':'var(--text-muted)' },
            { label: 'Open Bills',    value: s.open_bills ?? 0,          color: 'var(--text-primary)' },
            { label: 'Advance',       value: formatINR(s.advance),       color: 'var(--accent)' },
          ].map(k => (
            <div key={k.label} className="kpi-card" style={{ padding: '14px 16px' }}>
              <div className="kpi-label">{k.label}</div>
              <div style={{ fontSize: 17, fontWeight: 800, color: k.color, marginTop: 6 }}>{k.value}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="tabs" style={{ marginBottom: 16, width: 'fit-content' }}>
          {[['bills','📄 Bills'],['payments','💳 Payments'],['ledger','📒 Ledger']].map(([id,label]) => (
            <button key={id} className={`tab ${tab===id?'active':''}`} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>

        {loading ? (
          <div className="spinner-wrap"><div className="spinner" /></div>
        ) : (
          <>
            {/* ── Bills Tab ── */}
            {tab === 'bills' && (
              <div className="table-wrapper">
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Invoice No</th>
                        <th>Date</th>
                        <th>Due Date</th>
                        <th className="td-right">Amount</th>
                        <th className="td-right">Paid</th>
                        <th className="td-right">Balance</th>
                        <th>Status</th>
                        <th>Days</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bills.map(b => (
                        <tr key={b.invoice_id}>
                          <td className="text-muted">{b.fifo_seq}</td>
                          <td className="td-primary td-mono">{b.bill_no}</td>
                          <td>{formatDate(b.bill_date)}</td>
                          <td style={{ color: b.is_overdue?'var(--red)':undefined }}>{formatDate(b.due_date)}</td>
                          <td className="td-right td-mono">{formatINR(b.amount)}</td>
                          <td className="td-right td-mono" style={{ color: 'var(--green)' }}>{formatINR(b.paid)}</td>
                          <td className="td-right td-mono" style={{ color: b.balance>0?'var(--yellow-light)':'var(--text-muted)', fontWeight: b.balance>0?700:400 }}>{formatINR(b.balance)}</td>
                          <td>
                            <span className={`flag-badge ${b.status==='PAID'?'flag-GREEN':b.is_overdue?'flag-RED':'flag-YELLOW'}`} style={{ fontSize: 11 }}>
                              {b.status}
                            </span>
                          </td>
                          <td style={{ fontSize: 12 }}>
                            {b.is_overdue ? <span style={{ color:'var(--red)' }}>+{b.days_overdue}d</span>
                              : b.days_to_due != null ? `${b.days_to_due}d left` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {bills.length === 0 && <div className="empty-state"><div className="empty-icon">📄</div><p>No bills</p></div>}
                </div>
              </div>
            )}

            {/* ── Payments Tab ── */}
            {tab === 'payments' && (
              <div className="table-wrapper">
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Mode</th>
                        <th>Reference</th>
                        <th className="td-right">Amount</th>
                        <th>Remarks</th>
                        <th style={{ textAlign: 'center', width: 100 }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.map(p => (
                        <tr key={p.id}>
                          <td style={{ fontWeight: 500 }}>{formatDate(p.payment_date)}</td>
                          <td><span className="badge badge-blue">{p.mode_name}</span></td>
                          <td className="td-mono" style={{ fontSize: 12 }}>{p.reference_no || '—'}</td>
                          <td className="td-right td-mono" style={{ fontWeight: 800, fontSize: 14, color: 'var(--green)' }}>{formatINR(p.amount)}</td>
                          <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{p.remarks || '—'}</td>
                          <td>
                            <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                              {/* Receipt */}
                              <button title="View Receipt"
                                onClick={() => setReceiptPayment(p)}
                                style={{ background:'none', border:'1px solid var(--border)', borderRadius:6, cursor:'pointer', width:30, height:30, display:'flex', alignItems:'center', justifyContent:'center', fontSize:15 }}
                                onMouseEnter={e=>e.currentTarget.style.background='var(--blue-bg)'}
                                onMouseLeave={e=>e.currentTarget.style.background='none'}
                              >🧾</button>
                              {/* Edit */}
                              <button title="Edit"
                                onClick={() => setEditPayment(p)}
                                style={{ background:'none', border:'1px solid var(--border)', borderRadius:6, cursor:'pointer', width:30, height:30, display:'flex', alignItems:'center', justifyContent:'center', fontSize:14 }}
                                onMouseEnter={e=>e.currentTarget.style.background='var(--yellow-bg)'}
                                onMouseLeave={e=>e.currentTarget.style.background='none'}
                              >✏️</button>
                              {/* Delete */}
                              <button title="Delete"
                                onClick={() => setDeletePayment(p)}
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
                  {payments.length === 0 && <div className="empty-state"><div className="empty-icon">💳</div><p>No payments yet</p></div>}
                </div>
              </div>
            )}

            {/* ── Ledger Tab ── */}
            {tab === 'ledger' && (
              <div className="table-wrapper">
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Date</th>
                        <th>Type</th>
                        <th>Ref No</th>
                        <th>Particulars</th>
                        <th className="td-right">Bill Amt</th>
                        <th className="td-right">Paid Amt</th>
                        <th className="td-right">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledger.map(l => (
                        <tr key={l.line_no}>
                          <td className="text-muted">{l.line_no}</td>
                          <td>{formatDate(l.entry_date)}</td>
                          <td>
                            <span className={`badge ${l.entry_type==='BILL'?'badge-red':l.entry_type==='PAYMENT'?'badge-green':l.entry_type==='OPENING'?'badge-yellow':'badge-blue'}`} style={{ fontSize: 10 }}>
                              {l.entry_type}
                            </span>
                          </td>
                          <td className="td-mono" style={{ fontSize: 11 }}>{l.ref_no || '—'}</td>
                          <td style={{ fontSize: 12, color: 'var(--text-secondary)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.particulars}</td>
                          <td className="td-right td-mono" style={{ color: l.bill_amount>0?'var(--red)':'var(--text-muted)' }}>{l.bill_amount>0?formatINR(l.bill_amount):'—'}</td>
                          <td className="td-right td-mono" style={{ color: l.paid_amount>0?'var(--green)':'var(--text-muted)' }}>{l.paid_amount>0?formatINR(l.paid_amount):'—'}</td>
                          <td className="td-right">
                            <span className={`ledger-balance ${Number(l.running_balance)>0?'positive':'zero'}`}>{formatINR(l.running_balance)}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    {ledger.length > 0 && (
                      <tfoot>
                        <tr style={{ background: 'var(--bg-elevated)', borderTop: '2px solid var(--border)' }}>
                          <td colSpan={5} style={{ fontWeight: 700, padding: '11px 14px' }}>CLOSING BALANCE</td>
                          <td className="td-right td-mono" style={{ fontWeight: 700, color: 'var(--red)' }}>{formatINR(ledger.reduce((s,l)=>s+Number(l.bill_amount||0),0))}</td>
                          <td className="td-right td-mono" style={{ fontWeight: 700, color: 'var(--green)' }}>{formatINR(ledger.reduce((s,l)=>s+Number(l.paid_amount||0),0))}</td>
                          <td className="td-right">
                            <span style={{ fontWeight: 800, fontSize: 15, color: Number(ledger.at(-1)?.running_balance)>0?'var(--red)':'var(--green)' }}>
                              {formatINR(ledger.at(-1)?.running_balance)}
                            </span>
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                  {ledger.length === 0 && <div className="empty-state"><div className="empty-icon">📒</div><p>No ledger entries</p></div>}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Modals ── */}
      {showPayForm && (
        <PaymentForm party={s} onClose={() => setShowPayForm(false)} onSaved={() => { load() }} />
      )}
      {showEditForm && (
        <PartyForm party={s} onClose={() => setShowEditForm(false)} onSaved={() => { setShowEditForm(false); load() }} />
      )}
      {editPayment && (
        <PaymentForm
          party={s}
          payment={editPayment}
          onClose={() => setEditPayment(null)}
          onSaved={() => { setEditPayment(null); load() }}
        />
      )}
      {receiptPayment && (
        <PaymentReceipt
          payment={receiptPayment}
          party={s}
          onClose={() => setReceiptPayment(null)}
        />
      )}
      {confirmDeactivate && (
        <DoubleConfirm
          title="Deactivate Supplier?"
          body={<><strong>{s.party_name}</strong><br/>Outstanding: {formatINR(s.outstanding)}<br/><span style={{ fontSize:12,color:'var(--text-muted)' }}>All invoices & payments are preserved.</span></>}
          onConfirm={deactivate}
          onCancel={() => setConfirmDeactivate(false)}
          busy={deactivating}
        />
      )}
      {deletePayment && (
        <DoubleConfirm
          title="Delete Payment?"
          body={<><strong>{formatDate(deletePayment.payment_date)}</strong> · {formatINR(deletePayment.amount)}<br/>{deletePayment.mode_name}<br/><span style={{ fontSize:12,color:'var(--text-muted)' }}>This will permanently remove this payment and recalculate FIFO.</span></>}
          onConfirm={deletePaymentEntry}
          onCancel={() => setDeletePayment(null)}
          busy={deletingPay}
        />
      )}
    </div>
  )
}
