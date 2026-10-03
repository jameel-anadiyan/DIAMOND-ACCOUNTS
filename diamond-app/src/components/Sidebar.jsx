export default function Sidebar({ page, setPage, onSignOut }) {
  const nav = [
    { id: 'dashboard', icon: '📊', label: 'Dashboard' },
    { id: 'parties',   icon: '🏢', label: 'Suppliers' },
    { id: 'invoices',  icon: '📄', label: 'Invoices' },
    { id: 'payments',  icon: '💳', label: 'Payments' },
    { id: 'ledger',    icon: '📒', label: 'Ledger' },
    { id: 'settings',  icon: '⚙️',  label: 'Settings' },
  ]

  return (
    <nav className="sidebar">
      {/* Logo */}
      <div className="sidebar-logo">
        <img
          src="/logo.png"
          alt="Logo"
          style={{ width: 44, height: 44, objectFit: 'contain', borderRadius: 6 }}
        />
      </div>

      <div className="sidebar-nav">
        <div className="nav-section-label">Menu</div>
        {nav.map(item => (
          <div
            key={item.id}
            className={`nav-item ${page === item.id ? 'active' : ''}`}
            onClick={() => setPage(item.id)}
          >
            <span className="nav-icon">{item.icon}</span>
            <span>{item.label}</span>
          </div>
        ))}
      </div>

      <div className="sidebar-footer">
        <button
          onClick={onSignOut}
          className="btn btn-ghost"
          style={{ width: '100%', justifyContent: 'center', fontSize: 12 }}
        >
          🔒 Lock
        </button>
      </div>
    </nav>
  )
}
