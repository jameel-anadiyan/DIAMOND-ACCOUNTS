import { supabase } from './supabase'

const LOCAL_STORAGE_KEY = 'da_selling_records_v1'

let cachedModeId = null

function generateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'sel_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9)
}

export async function getSellingAdjustmentModeId() {
  if (cachedModeId) return cachedModeId
  try {
    const { data: modes } = await supabase
      .from('payment_modes')
      .select('id, name')
      .eq('is_active', true)
    
    if (modes?.length) {
      const target = modes.find(m => 
        m.name.toLowerCase().includes('selling') || 
        m.name.toLowerCase().includes('adjustment')
      )
      if (target) {
        cachedModeId = target.id
        return target.id
      }
      const other = modes.find(m => m.name.toLowerCase() === 'other')
      if (other) {
        cachedModeId = other.id
        return other.id
      }
      cachedModeId = modes[0].id
      return cachedModeId
    }
  } catch (err) {
    console.error('Failed to get payment mode:', err)
  }
  return 10 // fallback default
}

/**
 * Fetch all selling records.
 */
export async function getSellingRecords() {
  let partyMap = {}
  let balanceMap = {}

  try {
    const { data: parties } = await supabase.from('parties').select('id, name').order('name')
    ;(parties || []).forEach(p => { partyMap[p.id] = p.name })
  } catch (err) {
    console.warn('Failed to load parties in sellingService:', err)
  }

  try {
    const res = await supabase.rpc('fn_bill_status', { p_as_of: new Date().toISOString().split('T')[0] })
    if (res && res.data) {
      res.data.forEach(b => {
        balanceMap[b.party_id] = (balanceMap[b.party_id] || 0) + Number(b.balance || 0)
      })
    }
  } catch {
    // If rpc call has error, continue gracefully
  }

  // Try direct selling_records table in Supabase
  try {
    const { data, error } = await supabase
      .from('selling_records')
      .select('*, supplier:parties(id, name), payment:party_payments(id, amount, payment_date, reference_no, is_cancelled)')
      .order('selling_date', { ascending: false })

    if (!error && Array.isArray(data)) {
      return data.map(item => {
        const rawLines = item.lines || [
          { line_no: 1, quantity: Number(item.quantity) || 0, carat_rate: Number(item.carat_rate) || 0, amount: Number(item.total_amount) || 0 }
        ]
        return {
          ...item,
          supplier_name: item.supplier?.name || partyMap[item.supplier_id] || 'Unknown Supplier',
          supplier_balance: balanceMap[item.supplier_id] || 0,
          lines: rawLines,
          payment_status: item.payment_status || (item.payment_type ? 'paid' : 'unpaid'),
          payment_type: item.payment_type || null,
        }
      })
    }
  } catch {
    // Table not ready yet, continue to audit_log + localStorage
  }

  // Fallback: load from Supabase audit_log for table_name = 'selling_portal'
  let cloudRecords = []
  try {
    const { data: auditRows } = await supabase
      .from('audit_log')
      .select('*')
      .eq('table_name', 'selling_portal')
      .order('changed_at', { ascending: false })

    if (auditRows && auditRows.length > 0) {
      const byRowId = new Map()
      for (const row of auditRows) {
        const rowId = row.row_id || row.new_data?.id
        if (!rowId || byRowId.has(rowId)) continue
        if (row.action === 'DELETE') {
          byRowId.set(rowId, null) // deleted
        } else if (row.new_data) {
          byRowId.set(rowId, row.new_data)
        }
      }
      cloudRecords = Array.from(byRowId.values()).filter(Boolean)
    }
  } catch (err) {
    console.warn('audit_log fetch warning:', err)
  }

  // Also check localStorage
  let localRecords = []
  try {
    const local = localStorage.getItem(LOCAL_STORAGE_KEY)
    if (local) localRecords = JSON.parse(local)
  } catch {}

  // Merge cloud and local
  const combinedMap = new Map()
  for (const r of cloudRecords) {
    if (r && r.id) combinedMap.set(r.id, r)
  }
  for (const r of localRecords) {
    if (r && r.id && !combinedMap.has(r.id)) combinedMap.set(r.id, r)
  }

  const merged = Array.from(combinedMap.values()).map(item => {
    const rawLines = item.lines || [
      { line_no: 1, quantity: Number(item.quantity) || 0, carat_rate: Number(item.carat_rate) || 0, amount: Number(item.total_amount) || 0 }
    ]
    return {
      ...item,
      supplier_name: partyMap[item.supplier_id] || item.supplier_name || 'Unknown Supplier',
      supplier_balance: balanceMap[item.supplier_id] || 0,
      lines: rawLines,
      payment_status: item.payment_status || (item.payment_type ? 'paid' : 'unpaid'),
      payment_type: item.payment_type || null,
    }
  })

  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(merged))
  } catch {}

  return merged.sort((a, b) => new Date(b.selling_date || b.created_at) - new Date(a.selling_date || a.created_at))
}

/**
 * Save (create or update) a selling record.
 * Initially recorded without payment selection (unpaid).
 */
export async function saveSellingRecord(record, isEdit = false) {
  const today = new Date().toISOString().split('T')[0]
  const sellingDate = record.selling_date || today

  // Process multiple lines / lots
  const lines = (record.lines && record.lines.length > 0)
    ? record.lines.map((l, idx) => {
        const q = parseFloat(l.quantity) || 0
        const r = parseFloat(l.carat_rate) || 0
        const amt = parseFloat(l.amount) || Number((q * r).toFixed(2))
        return {
          line_no: idx + 1,
          description: l.description || '',
          quantity: q,
          carat_rate: r,
          amount: amt,
        }
      })
    : [
        {
          line_no: 1,
          description: '',
          quantity: parseFloat(record.quantity) || 0,
          carat_rate: parseFloat(record.carat_rate) || 0,
          amount: parseFloat(record.total_amount) || 0,
        }
      ]

  const totalQuantity = lines.reduce((s, l) => s + l.quantity, 0)
  const totalAmount = lines.reduce((s, l) => s + l.amount, 0)
  const primaryCaratRate = totalQuantity > 0 ? Number((totalAmount / totalQuantity).toFixed(2)) : 0

  const finalRecord = {
    ...record,
    id: record.id || generateId(),
    lines,
    quantity: totalQuantity,
    carat_rate: primaryCaratRate,
    total_amount: totalAmount,
    selling_date: sellingDate,
    payment_status: record.payment_status || 'unpaid',
    payment_type: record.payment_type || null,
    payment_id: record.payment_id || null,
    updated_at: new Date().toISOString(),
    created_at: record.created_at || new Date().toISOString(),
  }

  // If already paid and adjusted, update payment transaction amount if modified
  if (finalRecord.payment_status === 'paid' && finalRecord.payment_type === 'adjusted' && finalRecord.payment_id) {
    try {
      await supabase.from('party_payments').update({
        party_id: finalRecord.supplier_id,
        payment_date: finalRecord.selling_date,
        amount: finalRecord.total_amount,
        reference_no: `Sale: ${finalRecord.title || 'Diamond Sale'}`,
        remarks: `Selling balance adjustment: ${finalRecord.title} (${Number(finalRecord.quantity).toFixed(3)} ct)`,
      }).eq('id', finalRecord.payment_id)
    } catch (err) {
      console.warn('Failed to update linked payment:', err)
    }
  }

  // Persist to selling_records table if exists
  let savedInTable = false
  try {
    const tablePayload = {
      id: finalRecord.id,
      title: finalRecord.title,
      supplier_id: finalRecord.supplier_id,
      quantity: Number(finalRecord.quantity),
      carat_rate: Number(finalRecord.carat_rate),
      total_amount: finalRecord.total_amount,
      selling_date: finalRecord.selling_date,
      due_date: finalRecord.due_date,
      payment_type: finalRecord.payment_type,
      payment_id: finalRecord.payment_id,
      remarks: finalRecord.remarks || null,
    }

    const { error: tblErr } = await supabase.from('selling_records').upsert(tablePayload)
    if (!tblErr) savedInTable = true
  } catch {
    savedInTable = false
  }

  // Save to audit_log if table does not exist
  if (!savedInTable) {
    try {
      await supabase.from('audit_log').insert({
        table_name: 'selling_portal',
        row_id: finalRecord.id,
        action: isEdit ? 'UPDATE' : 'INSERT',
        new_data: finalRecord,
      })
    } catch (err) {
      console.warn('audit_log insert warning:', err)
    }
  }

  // Update local storage
  try {
    const local = localStorage.getItem(LOCAL_STORAGE_KEY)
    let list = local ? JSON.parse(local) : []
    const idx = list.findIndex(x => x.id === finalRecord.id)
    if (idx >= 0) {
      list[idx] = finalRecord
    } else {
      list.unshift(finalRecord)
    }
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(list))
  } catch {}

  return finalRecord
}

/**
 * Mark a selling record as PAID.
 * Asks / settles as either 'collected' or 'adjusted'.
 * When 'adjusted', creates a payment entry in party_payments for that supplier.
 */
export async function markSellingAsPaid(record, paymentType) {
  const today = new Date().toISOString().split('T')[0]
  let paymentId = record.payment_id || null

  if (paymentType === 'adjusted') {
    const modeId = await getSellingAdjustmentModeId()
    const paymentPayload = {
      party_id: record.supplier_id,
      payment_date: record.selling_date || today,
      amount: Number(record.total_amount),
      mode_id: modeId,
      reference_no: `Sale: ${record.title || 'Diamond Sale'}`,
      remarks: `Selling balance adjustment: ${record.title} (${Number(record.quantity).toFixed(3)} ct)`,
    }

    if (paymentId) {
      const { error: updErr } = await supabase.from('party_payments').update(paymentPayload).eq('id', paymentId)
      if (updErr) {
        const { data: newPay } = await supabase.from('party_payments').insert(paymentPayload).select('id').single()
        if (newPay) paymentId = newPay.id
      }
    } else {
      const { data: newPay, error: insErr } = await supabase.from('party_payments').insert(paymentPayload).select('id').single()
      if (insErr) {
        throw new Error('Failed to record payment transaction in supplier balance: ' + insErr.message)
      }
      if (newPay) paymentId = newPay.id
    }
  } else if (paymentType === 'collected') {
    // If was previously adjusted and had paymentId, remove it
    if (paymentId) {
      try {
        await supabase.from('party_payments').delete().eq('id', paymentId)
      } catch {}
      paymentId = null
    }
  }

  const updatedRecord = {
    ...record,
    payment_status: 'paid',
    payment_type: paymentType,
    payment_id: paymentId,
    updated_at: new Date().toISOString(),
  }

  // Update in audit_log / selling_records table / localStorage
  try {
    await supabase.from('audit_log').insert({
      table_name: 'selling_portal',
      row_id: updatedRecord.id,
      action: 'UPDATE',
      new_data: updatedRecord,
    })
  } catch {}

  try {
    await supabase.from('selling_records').update({
      payment_type: paymentType,
      payment_id: paymentId,
    }).eq('id', updatedRecord.id)
  } catch {}

  try {
    const local = localStorage.getItem(LOCAL_STORAGE_KEY)
    if (local) {
      const list = JSON.parse(local).map(x => x.id === updatedRecord.id ? updatedRecord : x)
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(list))
    }
  } catch {}

  return updatedRecord
}

/**
 * Mark a selling record as UNPAID.
 * Removes any linked payment transaction from party_payments.
 */
export async function markSellingAsUnpaid(record) {
  if (record.payment_id) {
    try {
      await supabase.from('party_payments').delete().eq('id', record.payment_id)
    } catch (err) {
      console.warn('Failed to delete payment transaction:', err)
    }
  }

  const updatedRecord = {
    ...record,
    payment_status: 'unpaid',
    payment_type: null,
    payment_id: null,
    updated_at: new Date().toISOString(),
  }

  try {
    await supabase.from('audit_log').insert({
      table_name: 'selling_portal',
      row_id: updatedRecord.id,
      action: 'UPDATE',
      new_data: updatedRecord,
    })
  } catch {}

  try {
    await supabase.from('selling_records').update({
      payment_type: null,
      payment_id: null,
    }).eq('id', updatedRecord.id)
  } catch {}

  try {
    const local = localStorage.getItem(LOCAL_STORAGE_KEY)
    if (local) {
      const list = JSON.parse(local).map(x => x.id === updatedRecord.id ? updatedRecord : x)
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(list))
    }
  } catch {}

  return updatedRecord
}

/**
 * Delete a selling record and remove any linked payment transaction from party_payments.
 */
export async function deleteSellingRecord(record) {
  if (record.payment_id) {
    try {
      await supabase.from('party_payments').delete().eq('id', record.payment_id)
    } catch (err) {
      console.warn('Failed to delete linked payment:', err)
    }
  }

  try {
    await supabase.from('selling_records').delete().eq('id', record.id)
  } catch {}

  try {
    await supabase.from('audit_log').insert({
      table_name: 'selling_portal',
      row_id: record.id,
      action: 'DELETE',
      old_data: { id: record.id },
    })
  } catch {}

  try {
    const local = localStorage.getItem(LOCAL_STORAGE_KEY)
    if (local) {
      const list = JSON.parse(local).filter(x => x.id !== record.id)
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(list))
    }
  } catch {}

  return true
}
