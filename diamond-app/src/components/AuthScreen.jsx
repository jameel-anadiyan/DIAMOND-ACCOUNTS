import { useState } from 'react'

const SECRET = '5005'

export default function PasswordGate({ onUnlock }) {
  const [val, setVal] = useState('')
  const [shake, setShake] = useState(false)
  const [error, setError] = useState(false)

  function attempt(e) {
    e.preventDefault()
    if (val === SECRET) {
      localStorage.setItem('da_unlocked', '1')
      onUnlock()
    } else {
      setError(true)
      setShake(true)
      setVal('')
      setTimeout(() => setShake(false), 500)
      setTimeout(() => setError(false), 2000)
    }
  }

  return (
    <div className="auth-screen">
      <div
        className="auth-card"
        style={{ animation: shake ? 'shake 0.4s ease' : undefined, maxWidth: 360 }}
      >
        <div className="auth-logo" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 24 }}>
          <div style={{ position: 'relative', width: 130, height: 130, marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {/* Circling decorative orbit ring */}
            <div
              style={{
                position: 'absolute',
                inset: -8,
                borderRadius: '50%',
                border: '2px dashed rgba(26, 86, 219, 0.3)',
                animation: 'orbitRing 14s linear infinite',
              }}
            />
            {/* Circling Logo */}
            <img
              src="/logo.png"
              alt="Diamond Logo"
              style={{
                width: 130,
                height: 130,
                objectFit: 'contain',
                animation: 'circlingLogo 8s linear infinite',
                transformOrigin: 'center center',
                display: 'block',
                filter: 'drop-shadow(0 6px 14px rgba(26, 86, 219, 0.15))',
              }}
            />
          </div>
          <div className="auth-sub" style={{ fontSize: 13, color: 'var(--text-muted)' }}>Enter password to continue</div>
        </div>

        <form onSubmit={attempt}>
          <div className="form-group">
            <input
              id="password-input"
              className="input"
              type="password"
              placeholder="••••"
              value={val}
              onChange={e => setVal(e.target.value)}
              autoFocus
              style={{
                textAlign: 'center',
                fontSize: 28,
                fontWeight: 800,
                letterSpacing: '0.4em',
                border: error ? '1.5px solid var(--red)' : undefined,
                transition: 'border 0.2s',
              }}
              maxLength={10}
            />
            {error && (
              <div style={{ color: 'var(--red)', fontSize: 12, textAlign: 'center', marginTop: 8 }}>
                Incorrect password
              </div>
            )}
          </div>
          <button
            className="btn btn-primary"
            type="submit"
            style={{ width: '100%', justifyContent: 'center', marginTop: 4, fontSize: 15, padding: '10px' }}
          >
            Unlock
          </button>
        </form>
      </div>

      <style>{`
        @keyframes shake {
          0%,100%{ transform: translateX(0); }
          20%     { transform: translateX(-10px); }
          40%     { transform: translateX(10px); }
          60%     { transform: translateX(-8px); }
          80%     { transform: translateX(8px); }
        }
        @keyframes circlingLogo {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes orbitRing {
          from { transform: rotate(0deg); }
          to   { transform: rotate(-360deg); }
        }
      `}</style>
    </div>
  )
}
