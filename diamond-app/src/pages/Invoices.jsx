import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { formatINR, formatDate } from '../lib/utils'
import InvoiceForm from '../components/InvoiceForm'
import DoubleConfirm from '../components/DoubleConfirm'

export default function Invoices() {
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('ALL')
  const [showForm, setShowForm] = useState(false)
  const [editInvoice, setEditInvoice] = useState(null)
  const [cancelInvoice, setCancelInvoice] = useState(null)
  const [cancelling, setCancelling] = useState(false)
  const [sortCol, setSortCol] = useState('invoice_date')
  const [sortDir, setSortDir] = useState('desc')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const today = new Date().toISOString().split('T')[0]
    const { data: invData } = await supabase
      .from('purchase_invoices')
      .select('*, party:parties(name), lines:purchase_invoice_lines(*)')
      .order('invoice_date', { ascending: false })
    const { data: bsData } = await supabase.rpc('fn_bill_status', { p_as_of: today })
    const bsMap = {}
    ;(bsData||[]).forEach(b => { bsMap[b.invoice_id] = b })
    const merged = (invData||[]).map(inv => {
      const bs = bsMap[inv.id] || {}
      const lines = inv.lines || []
      const gross = lines.reduce((s,l) => s + Number(l.weight)*Number(l.rate), 0)
      const qcAmt = lines.reduce((s,l) => s + Number(l.qc_return_weight)*Number(l.rate), 0)
      const taxable = gross - qcAmt
      const tax = taxable * (inv.tax_rate_percent||0)/100
      const net = inv.bill_type==='OPENING' ? Number(inv.opening_amount) : (taxable+tax+Number(inv.round_off||0))
      return {
        ...inv, invoice_id: inv.id,
        party_name: inv.party?.name,
        total_weight: lines.reduce((s,l)=>s+Number(l.weight),0),
        net_payable: net||0,
        paid: bs.paid||0,
        balance: bs.balance ?? (inv.is_cancelled?0:(net||0)),
        status: inv.is_cancelled?'CANCELLED':(bs.status||'UPCOMING'),
        is_overdue: bs.is_overdue||false,
        days_overdue: bs.days_overdue||0,
        days_to_due: bs.days_to_due,
      }
    })
    setInvoices(merged)
    setLoading(false)
  }

  async function handleCancel() {
    setCancelling(true)
    await supabase.from('purchase_invoices').update({ is_cancelled: true }).eq('id', cancelInvoice.id)
    setCancelling(false)
    setCancelInvoice(null)
    load()
  }

  function toggleSort(col) {
    if (sortCol === col) setSortDir(d => d==='asc'?'desc':'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  const filtered = invoices
    .filter(i => {
      const s = search.toLowerCase()
      const matchSearch = !search || i.invoice_no?.toLowerCase().includes(s) || i.party_name?.toLowerCase().includes(s)
      const matchStatus = filterStatus==='ALL' || (filterStatus==='OVERDUE'&&i.is_overdue) || i.status===filterStatus
      return matchSearch && matchStatus
    })
    .sort((a,b) => {
      let va=a[sortCol], vb=b[sortCol]
      if(typeof va==='string') va=va.toLowerCase()
      if(typeof vb==='string') vb=vb.toLowerCase()
      return sortDir==='asc'?(va>vb?1:-1):(va<vb?1:-1)
    })

  function SortTh({ col, children }) {
    return (
      <th onClick={() => toggleSort(col)} style={{ cursor:'pointer', userSelect:'none' }}>
        {children}{sortCol===col?(sortDir==='asc'?' ↑':' ↓'):''}
      </th>
    )
  }

  if (loading) return <div className="spinner-wrap"><div className="spinner" />Loading invoices…</div>

  return (
    <div>
      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 800 }}>Invoices</h1>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>{invoices.filter(i=>!i.is_cancelled).length} active</div>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-ghost btn-sm" onClick={load}>🔄 Refresh</button>
            <button className="btn btn-primary" onClick={() => { setEditInvoice(null); setShowForm(true) }}>+ New Invoice</button>
          </div>
        </div>
      </div>

      <div className="page-body">
        <div className="flex gap-3" style={{ flexWrap:'wrap', marginBottom:16 }}>
          <div className="search-box" style={{ flex:1, minWidth:200 }}>
            <span className="search-icon">🔍</span>
            <input className="input" placeholder="Search invoice no or supplier…" value={search} onChange={e=>setSearch(e.target.value)} />
          </div>
          <div className="tabs">
            {[['ALL','All'],['UNPAID','Unpaid'],['PART_PAID','Part Paid'],['OVERDUE','🔴 Overdue'],['PAID','✅ Paid'],['CANCELLED','Cancelled']].map(([v,l]) => (
              <button key={v} className={`tab ${filterStatus===v?'active':''}`} onClick={()=>setFilterStatus(v)}>{l}</button>
            ))}
          </div>
        </div>

        <div className="table-wrapper">
          <div className="table-header">
            <div className="table-title">Purchase Invoices</div>
            <div style={{ fontSize:12, color:'var(--text-muted)' }}>{filtered.length} shown</div>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <SortTh col="invoice_no">Invoice No</SortTh>
                  <SortTh col="party_name">Supplier</SortTh>
                  <SortTh col="invoice_date">Date</SortTh>
                  <SortTh col="due_date">Due Date</SortTh>
                  <SortTh col="net_payable">Net Payable</SortTh>
                  <SortTh col="balance">Balance</SortTh>
                  <th>Status</th>
                  <th style={{ textAlign:'center', width:80 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(inv => (
                  <tr key={inv.id} style={{ opacity: inv.is_cancelled ? 0.55 : 1 }}>
                    <td className="td-primary td-mono" style={{ fontWeight: 700 }}>{inv.invoice_no}</td>
                    <td style={{ fontWeight:600, fontSize:13.5 }}>{inv.party_name}</td>
                    <td>{formatDate(inv.invoice_date)}</td>
                    <td style={{ color:inv.is_overdue?'var(--red)':undefined, fontWeight:inv.is_overdue?700:400 }}>{formatDate(inv.due_date)}</td>
                    <td className="td-right td-mono" style={{ fontWeight:700, fontSize:14 }}>{formatINR(inv.net_payable)}</td>
                    <td className="td-right td-mono" style={{ color:inv.balance>0?(inv.is_overdue?'var(--red)':'var(--yellow-light)'):undefined, fontWeight:inv.balance>0?700:400 }}>
                      {inv.balance > 0 ? formatINR(inv.balance) : <span style={{ color:'var(--text-faint)' }}>—</span>}
                    </td>
                    <td>
                      <span className={`flag-badge ${inv.status==='PAID'?'flag-GREEN':inv.status==='CANCELLED'?'':'flag-'+( inv.is_overdue?'RED':'YELLOW')}`} style={{ fontSize:11 }}>
                        {inv.status}
                      </span>
                    </td>
                    <td>
                      <div style={{ display:'flex', gap:4, justifyContent:'center' }}>
                        {!inv.is_cancelled && (
                          <>
                            <button title="Edit" onClick={() => { setEditInvoice(inv); setShowForm(true) }}
                              style={{ background:'none', border:'1px solid var(--border)', borderRadius:6, cursor:'pointer', width:30, height:30, display:'flex', alignItems:'center', justifyContent:'center', fontSize:14 }}
                              onMouseEnter={e=>e.currentTarget.style.background='var(--yellow-bg)'}
                              onMouseLeave={e=>e.currentTarget.style.background='none'}
                            >✏️</button>
                            <button title="Cancel Invoice" onClick={() => setCancelInvoice(inv)}
                              style={{ background:'none', border:'1px solid var(--red-border)', borderRadius:6, cursor:'pointer', width:30, height:30, display:'flex', alignItems:'center', justifyContent:'center', fontSize:14 }}
                              onMouseEnter={e=>e.currentTarget.style.background='var(--red-bg)'}
                              onMouseLeave={e=>e.currentTarget.style.background='none'}
                            >🗑️</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && <div className="empty-state"><div className="empty-icon">📄</div><p>No invoices found</p></div>}
          </div>
        </div>
      </div>

      {showForm && (
        <InvoiceForm
          invoice={editInvoice}
          onClose={() => { setShowForm(false); setEditInvoice(null) }}
          onSaved={() => { setShowForm(false); setEditInvoice(null); load() }}
        />
      )}
      {cancelInvoice && (
        <DoubleConfirm
          title="Cancel Invoice?"
          body={<><strong>{cancelInvoice.invoice_no}</strong> — {cancelInvoice.party_name}<br/>{formatDate(cancelInvoice.invoice_date)} · {formatINR(cancelInvoice.net_payable)}<br/><span style={{ fontSize:12,color:'var(--text-muted)' }}>Invoice will be marked cancelled. All associated payments remain.</span></>}
          onConfirm={handleCancel}
          onCancel={() => setCancelInvoice(null)}
          busy={cancelling}
        />
      )}
    </div>
  )
}
