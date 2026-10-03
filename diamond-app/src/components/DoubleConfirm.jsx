import { useState } from 'react'

/**
 * DoubleConfirm — two-step deletion confirmation.
 * Step 1: "Are you sure?"   →  click "Yes, Continue"
 * Step 2: "This is final."  →  click "Yes, DELETE"
 */
export default function DoubleConfirm({ title, body, onConfirm, onCancel, busy }) {
  const [step, setStep] = useState(1)

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title" style={{ color: 'var(--red)' }}>
            {step === 1 ? '⚠️ ' : '🔴 '}{title}
          </div>
          <button className="modal-close" onClick={onCancel}>✕</button>
        </div>

        {step === 1 ? (
          <>
            <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.8 }}>{body}</div>
            <div style={{ marginTop: 14, padding: '10px 14px', background: 'var(--yellow-bg)', border: '1px solid var(--yellow-border)', borderRadius: 'var(--radius-md)', fontSize: 13, color: 'var(--yellow-light)' }}>
              ⚠️ This action cannot be undone. Proceed?
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
              <button className="btn" style={{ background: 'var(--yellow)', color: 'white', border: 'none' }} onClick={() => setStep(2)}>
                Yes, Continue →
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.8 }}>{body}</div>
            <div style={{ marginTop: 14, padding: '12px 14px', background: 'var(--red-bg)', border: '2px solid var(--red-border)', borderRadius: 'var(--radius-md)', fontSize: 14, color: 'var(--red)', fontWeight: 700 }}>
              🔴 FINAL CONFIRMATION — This will permanently delete the record.
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setStep(1)}>← Go Back</button>
              <button
                className="btn"
                style={{ background: 'var(--red)', color: 'white', border: 'none', fontWeight: 800 }}
                onClick={onConfirm}
                disabled={busy}
              >
                {busy ? 'Deleting…' : '🗑️ YES, DELETE'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
