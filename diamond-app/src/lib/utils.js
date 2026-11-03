// Utility helpers
export const fmt = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})

export function formatINR(n) {
  if (n === null || n === undefined) return '₹0'
  return fmt.format(Number(n))
}

export function formatDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric'
  })
}

export function formatWeight(w) {
  if (w === null || w === undefined) return '—'
  return `${Number(w).toFixed(3)} ct`
}

export function flagClass(flag) {
  if (!flag) return ''
  if (flag === 'GREEN') return 'flag-GREEN'
  if (flag === 'YELLOW') return 'flag-YELLOW'
  return 'flag-RED'
}

export function flagIcon(flag) {
  if (flag === 'GREEN')  return '🟢'
  if (flag === 'YELLOW') return '🟡'
  return '🔴'
}

export function statusColor(status) {
  if (status === 'PAID')       return 'status-PAID'
  if (status === 'PART_PAID')  return 'status-PART_PAID'
  if (status === 'OVERDUE' || status?.includes('OVERDUE')) return 'status-OVERDUE'
  return 'status-UNPAID'
}

export function getDaysLeft(dueDateStr, baseDateStr = new Date().toISOString().split('T')[0]) {
  if (!dueDateStr) return { days: null, text: 'No due date', badgeClass: 'badge-grey', status: 'none', icon: '—' }
  
  const due = new Date(dueDateStr + 'T00:00:00')
  const base = new Date(baseDateStr + 'T00:00:00')
  const diffTime = due - base
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24))

  if (diffDays > 7) {
    return {
      days: diffDays,
      text: `${diffDays} days left`,
      badgeClass: 'badge-green',
      status: 'upcoming',
      icon: '⏳'
    }
  } else if (diffDays > 0) {
    return {
      days: diffDays,
      text: `${diffDays} ${diffDays === 1 ? 'day' : 'days'} left`,
      badgeClass: 'badge-yellow',
      status: 'due_soon',
      icon: '⚠️'
    }
  } else if (diffDays === 0) {
    return {
      days: 0,
      text: 'Due Today',
      badgeClass: 'badge-yellow',
      status: 'today',
      icon: '🚨'
    }
  } else {
    const overdue = Math.abs(diffDays)
    return {
      days: diffDays,
      text: `${overdue} ${overdue === 1 ? 'day' : 'days'} overdue`,
      badgeClass: 'badge-red',
      status: 'overdue',
      icon: '🔴'
    }
  }
}
