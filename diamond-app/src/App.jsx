import { useState, useEffect } from 'react'
import PasswordGate from './components/AuthScreen'
import PublicReceipt from './components/PublicReceipt'
import Sidebar from './components/Sidebar'
import Dashboard from './pages/Dashboard'
import Parties from './pages/Parties'
import Invoices from './pages/Invoices'
import Payments from './pages/Payments'
import Ledger from './pages/Ledger'
import Settings from './pages/Settings'
import './index.css'

export default function App() {
  const isReceiptLink = new URLSearchParams(window.location.search).get('receipt') === '1'
  const [unlocked, setUnlocked] = useState(false)
  const [history, setHistory] = useState(['dashboard']) // navigation stack

  const page = history[history.length - 1]

  useEffect(() => {
    if (localStorage.getItem('da_unlocked') === '1') setUnlocked(true)
  }, [])

  function navigate(p) {
    setHistory(h => [...h, p])
  }

  function goBack() {
    setHistory(h => h.length > 1 ? h.slice(0, -1) : h)
  }

  function lock() {
    localStorage.removeItem('da_unlocked')
    setUnlocked(false)
  }

  // Public receipt viewer when opened via WhatsApp link
  if (isReceiptLink) {
    return <PublicReceipt />
  }

  if (!unlocked) return <PasswordGate onUnlock={() => setUnlocked(true)} />

  const canGoBack = history.length > 1

  const pages = {
    dashboard: <Dashboard onNavigate={navigate} />,
    parties:   <Parties onNavigate={navigate} />,
    invoices:  <Invoices onNavigate={navigate} />,
    payments:  <Payments onNavigate={navigate} />,
    ledger:    <Ledger onNavigate={navigate} />,
    settings:  <Settings onNavigate={navigate} />,
  }

  return (
    <div className="app-shell">
      <Sidebar page={page} setPage={p => setHistory([p])} onSignOut={lock} />
      <div className="main-content">
        {/* Global back bar — only shows when navigated deeper */}
        {canGoBack && (
          <div style={{ 
            display:'flex', alignItems:'center', gap:10, 
            padding:'8px 24px', background:'var(--bg-elevated)', 
            borderBottom:'1px solid var(--border)', fontSize:13
          }}>
            <button className="btn btn-ghost btn-sm" onClick={goBack} style={{ gap:6, padding:'4px 10px' }}>
              ← Back
            </button>
            <span style={{ color:'var(--text-muted)' }}>
              {history.map((p,i) => (
                <span key={i}>
                  {i > 0 && <span style={{ margin:'0 6px', color:'var(--text-faint)' }}>›</span>}
                  <span style={{ 
                    textTransform:'capitalize', 
                    color: i === history.length-1 ? 'var(--text-primary)' : 'var(--text-muted)',
                    fontWeight: i === history.length-1 ? 600 : 400,
                    cursor: i < history.length-1 ? 'pointer' : 'default'
                  }}
                    onClick={() => i < history.length-1 && setHistory(h => h.slice(0, i+1))}
                  >{p}</span>
                </span>
              ))}
            </span>
          </div>
        )}
        {pages[page] || <Dashboard />}
      </div>
    </div>
  )
}
