import { useRef, useState } from 'react'
import html2canvas from 'html2canvas'
import { formatINR, formatDate } from '../lib/utils'

export default function PaymentReceipt({ payment, party, onClose }) {
  const receiptRef = useRef()
  const [status, setStatus] = useState('idle') // idle | capturing | done

  const waNumber   = localStorage.getItem('wa_number') || '917012677687'
  const bizName    = localStorage.getItem('biz_name')  || 'Diamond Accounts'
  const partyName  = party?.party_name || party?.name || payment?.party_name || '—'
  const paidAmt    = Number(payment?.amount ?? 0)
  const outstanding = Number(party?.outstanding ?? 0)
  const newBalance  = Math.max(0, outstanding - paidAmt)

  /* Build a shareable receipt URL */
  function getReceiptURL() {
    const base   = window.location.origin
    const params = new URLSearchParams({
      party:   partyName,
      amount:  paidAmt,
      date:    payment?.payment_date || '',
      mode:    payment?.mode_name    || 'Cash',
      ref:     payment?.reference_no || '',
      remarks: payment?.remarks      || '',
      balance: newBalance,
    })
    return `${base}/?receipt=1&${params.toString()}`
  }

  async function captureAndSend() {
    setStatus('capturing')
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
        if (!blob) { setStatus('idle'); return }

        // 1. Download image to device
        const url = URL.createObjectURL(blob)
        const a   = document.createElement('a')
        a.href     = url
        a.download = `receipt-${partyName.replace(/\s+/g, '-')}-${payment?.payment_date || 'receipt'}.png`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        setTimeout(() => URL.revokeObjectURL(url), 2000)

        // 2. Build the rich WhatsApp message
        const receiptLink = getReceiptURL()
        const date        = formatDate(payment?.payment_date)
        const mode        = payment?.mode_name || 'Cash'
        const ref         = payment?.reference_no ? `\nRef / UTR: *${payment.reference_no}*` : ''
        const balLine     = newBalance === 0
          ? '\n✅ *Account fully settled — Thank you!*'
          : `\nBalance remaining: *${formatINR(newBalance)}*`

        const waText = [
          `🙏 *Payment Acknowledgement — ${bizName}*`,
          `━━━━━━━━━━━━━━━━━━━━━━`,
          `Dear *${partyName}*,`,
          ``,
          `We are pleased to confirm receipt of your payment.`,
          ``,
          `💎 *Party  :* ${partyName}`,
          `💰 *Amount :* *${formatINR(paidAmt)}*`,
          `📅 *Date   :* ${date}`,
          `🏦 *Mode   :* ${mode}${ref}${balLine}`,
          ``,
          `📄 *View Your Digital Receipt:*`,
          receiptLink,
          ``,
          `━━━━━━━━━━━━━━━━━━━━━━`,
          `_${bizName} · Powered by Diamond Accounts_`,
        ].join('\n')

        setTimeout(() => {
          window.open(`https://wa.me/${waNumber}?text=${encodeURIComponent(waText)}`, '_blank')
          setStatus('done')
          setTimeout(() => setStatus('idle'), 3500)
        }, 800)
      }, 'image/png', 1.0)
    } catch (err) {
      console.error(err)
      setStatus('idle')
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 440 }}>

        {/* RECEIPT (captured as image) */}
        <div
          ref={receiptRef}
          style={{
            background: 'white',
            borderRadius: 16,
            padding: '28px 32px',
            fontFamily: 'Inter, sans-serif',
            border: '2px solid #e2e5ee',
            boxShadow: '0 8px 40px rgba(0,0,0,0.15)',
          }}
        >
          {/* Header with logo */}
          <div style={{ textAlign: 'center', marginBottom: 22, paddingBottom: 18, borderBottom: '2px dashed #e2e5ee' }}>
            <img
              src="/logo.png"
              alt="Logo"
              crossOrigin="anonymous"
              style={{ width: 60, height: 60, objectFit: 'contain', marginBottom: 10 }}
            />
            <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6 }}>
              PAYMENT RECEIPT
            </div>
            <div style={{ fontSize: 30, fontWeight: 900, color: '#111827', lineHeight: 1.15, margin: '4px 0 6px', letterSpacing: '-0.01em' }}>
              {partyName}
            </div>
            <div style={{ fontSize: 13, color: '#6b7280', fontWeight: 500 }}>
              {formatDate(payment?.payment_date)}
            </div>
          </div>

          {/* Amount prominent */}
          <div style={{
            background: '#eff6ff', border: '2px solid #bfdbfe',
            borderRadius: 12, padding: '20px 24px', textAlign: 'center', marginBottom: 20,
          }}>
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#1a56db', marginBottom: 6 }}>
              Amount Paid
            </div>
            <div style={{ fontSize: 46, fontWeight: 900, color: '#1a56db', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
              {formatINR(paidAmt)}
            </div>
          </div>

          {/* Details rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {[
              { label: 'Mode',         value: payment?.mode_name || 'Cash', bold: true },
              payment?.reference_no  ? { label: 'Ref / UTR',     value: payment.reference_no,      mono: true }                          : null,
              outstanding > 0        ? { label: 'Prev Balance',  value: formatINR(outstanding),    mono: true }                          : null,
              outstanding > 0        ? { label: 'Paid Now',      value: `− ${formatINR(paidAmt)}`, mono: true, color: '#16a34a' }        : null,
              payment?.remarks       ? { label: 'Remarks',       value: payment.remarks }                                                : null,
            ].filter(Boolean).map((row, i) => (
              <div key={i} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '8px 4px', borderBottom: '1px solid #f0f2f8', fontSize: 13,
              }}>
                <span style={{ color: '#6b7280', fontWeight: 500, fontSize: 12 }}>{row.label}</span>
                <span style={{
                  fontWeight: row.bold ? 700 : 600, color: row.color || '#111827',
                  fontFamily: row.mono ? 'monospace' : 'inherit', fontSize: 13,
                }}>{row.value}</span>
              </div>
            ))}

            {/* Balance after */}
            {outstanding > 0 && (
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                marginTop: 10, padding: '12px 14px',
                background: newBalance === 0 ? '#f0fdf4' : '#fef2f2',
                borderRadius: 8, border: `1.5px solid ${newBalance === 0 ? '#bbf7d0' : '#fecaca'}`,
              }}>
                <span style={{ fontWeight: 700, fontSize: 14, color: '#111827' }}>Balance After</span>
                <span style={{ fontWeight: 900, fontSize: 18, color: newBalance === 0 ? '#15803d' : '#b91c1c' }}>
                  {newBalance === 0 ? '✅ Nil — Cleared' : formatINR(newBalance)}
                </span>
              </div>
            )}
          </div>

          {/* Footer */}
          <div style={{ textAlign: 'center', marginTop: 20, paddingTop: 14, borderTop: '2px dashed #e2e5ee', fontSize: 11, color: '#9ca3af', lineHeight: 1.6 }}>
            Thank you for your payment 🙏
          </div>
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 10, marginTop: 14, justifyContent: 'center' }}>
          <button className="btn btn-ghost" onClick={onClose}>✕ Close</button>
          <button
            className="btn btn-whatsapp btn-lg"
            onClick={captureAndSend}
            disabled={status === 'capturing'}
            style={{ gap: 8, minWidth: 220 }}
          >
            {status === 'capturing' ? (
              <><div className="spinner" style={{ width:16, height:16, borderWidth:2, borderColor:'rgba(255,255,255,0.3)', borderTopColor:'white' }} /> Saving…</>
            ) : status === 'done' ? (
              <>✅ Saved &amp; WhatsApp opened!</>
            ) : (
              <>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
                📤 Send on WhatsApp
              </>
            )}
          </button>
        </div>

        <div style={{ textAlign:'center', marginTop:8, fontSize:11, color:'var(--text-faint)', lineHeight:1.6 }}>
          Receipt saved to device · WhatsApp opens with message &amp; clickable receipt link
        </div>
      </div>
    </div>
  )
}
