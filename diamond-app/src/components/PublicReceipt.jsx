import { useRef } from 'react'
import html2canvas from 'html2canvas'
import { formatINR, formatDate } from '../lib/utils'

export default function PublicReceipt() {
  const receiptRef = useRef()
  const search = new URLSearchParams(window.location.search)

  const partyName   = search.get('party') || 'Customer / Supplier'
  const paidAmt     = Number(search.get('amount') || 0)
  const dateStr     = search.get('date') || ''
  const mode        = search.get('mode') || 'Cash'
  const refNo       = search.get('ref') || ''
  const remarks     = search.get('remarks') || ''
  const balanceRaw  = search.get('balance')
  const newBalance  = balanceRaw !== null && balanceRaw !== '' ? Number(balanceRaw) : null

  async function handleDownload() {
    if (!receiptRef.current) return
    try {
      const canvas = await html2canvas(receiptRef.current, {
        scale: 3,
        backgroundColor: '#ffffff',
        useCORS: true,
        allowTaint: true,
        logging: false,
        windowWidth: 480,
      })
      canvas.toBlob(blob => {
        if (!blob) return
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `receipt-${partyName.replace(/\s+/g, '-')}.png`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        setTimeout(() => URL.revokeObjectURL(url), 2000)
      }, 'image/png', 1.0)
    } catch (err) {
      console.error(err)
    }
  }

  function handlePrint() {
    window.print()
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #f0f4ff 0%, #e8f0fe 50%, #f5f6fa 100%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '30px 16px',
      fontFamily: "'Inter', sans-serif",
    }}>
      {/* Top Banner */}
      <div style={{
        marginBottom: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: 'rgba(26,86,219,0.08)',
        color: '#1a56db',
        padding: '6px 14px',
        borderRadius: 20,
        fontSize: 12.5,
        fontWeight: 600,
      }}>
        <span>✓ Verified Official Payment Receipt</span>
      </div>

      {/* Printable / Savable Receipt Card */}
      <div
        ref={receiptRef}
        style={{
          background: 'white',
          borderRadius: 18,
          padding: '32px 36px',
          width: '100%',
          maxWidth: 440,
          border: '1.5px solid #e2e5ee',
          boxShadow: '0 12px 40px rgba(0,0,0,0.08)',
          position: 'relative',
        }}
      >
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 20, paddingBottom: 18, borderBottom: '2px dashed #e2e5ee' }}>
          <img
            src="/logo.png"
            alt="Diamond Accounts"
            style={{ width: 64, height: 64, objectFit: 'contain', marginBottom: 8 }}
          />
          <div style={{ fontSize: 11, fontWeight: 800, color: '#9ca3af', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6 }}>
            PAYMENT RECEIPT
          </div>
          <div style={{ fontSize: 26, fontWeight: 900, color: '#111827', lineHeight: 1.2, margin: '4px 0 6px', letterSpacing: '-0.01em' }}>
            {partyName}
          </div>
          <div style={{ fontSize: 13, color: '#6b7280', fontWeight: 500 }}>
            {dateStr ? formatDate(dateStr) : 'Payment Recorded'}
          </div>
        </div>

        {/* Amount Box */}
        <div style={{
          background: '#eff6ff',
          border: '2px solid #bfdbfe',
          borderRadius: 12,
          padding: '18px 24px',
          textAlign: 'center',
          marginBottom: 20,
        }}>
          <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#1a56db', marginBottom: 6 }}>
            Amount Paid
          </div>
          <div style={{ fontSize: 42, fontWeight: 900, color: '#1a56db', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
            {formatINR(paidAmt)}
          </div>
        </div>

        {/* Details Rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '8px 4px', borderBottom: '1px solid #f0f2f8', fontSize: 13,
          }}>
            <span style={{ color: '#6b7280', fontWeight: 500, fontSize: 12 }}>Payment Mode</span>
            <span style={{ fontWeight: 700, color: '#111827' }}>{mode}</span>
          </div>

          {refNo && (
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '8px 4px', borderBottom: '1px solid #f0f2f8', fontSize: 13,
            }}>
              <span style={{ color: '#6b7280', fontWeight: 500, fontSize: 12 }}>Ref / UTR</span>
              <span style={{ fontWeight: 600, color: '#111827', fontFamily: 'monospace' }}>{refNo}</span>
            </div>
          )}

          {remarks && (
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '8px 4px', borderBottom: '1px solid #f0f2f8', fontSize: 13,
            }}>
              <span style={{ color: '#6b7280', fontWeight: 500, fontSize: 12 }}>Remarks</span>
              <span style={{ fontWeight: 500, color: '#374151' }}>{remarks}</span>
            </div>
          )}

          {newBalance !== null && (
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              marginTop: 10, padding: '12px 14px',
              background: newBalance === 0 ? '#f0fdf4' : '#fef2f2',
              borderRadius: 8, border: `1.5px solid ${newBalance === 0 ? '#bbf7d0' : '#fecaca'}`,
            }}>
              <span style={{ fontWeight: 700, fontSize: 13.5, color: '#111827' }}>Balance Remaining</span>
              <span style={{ fontWeight: 900, fontSize: 16, color: newBalance === 0 ? '#15803d' : '#b91c1c' }}>
                {newBalance === 0 ? '✅ Nil — Settled' : formatINR(newBalance)}
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ textAlign: 'center', marginTop: 22, paddingTop: 14, borderTop: '2px dashed #e2e5ee', fontSize: 11, color: '#9ca3af', lineHeight: 1.6 }}>
          Thank you for your business 🙏
          <div style={{ fontSize: 10, marginTop: 4, color: '#cbd5e1' }}>
            Diamond Accounts · Official Acknowledgement
          </div>
        </div>
      </div>

      {/* Action buttons (Download & Print) */}
      <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
        <button
          onClick={handleDownload}
          style={{
            background: '#1a56db',
            color: 'white',
            border: 'none',
            padding: '10px 18px',
            borderRadius: 8,
            fontSize: 13.5,
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(26,86,219,0.25)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          ⬇ Download Image
        </button>
        <button
          onClick={handlePrint}
          style={{
            background: 'white',
            color: '#374151',
            border: '1px solid #d1d5db',
            padding: '10px 18px',
            borderRadius: 8,
            fontSize: 13.5,
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          🖨 Print Receipt
        </button>
      </div>
    </div>
  )
}
