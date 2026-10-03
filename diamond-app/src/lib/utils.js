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
