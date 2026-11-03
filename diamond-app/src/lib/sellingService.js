import { supabase } from './supabase'

const LOCAL_STORAGE_KEY = 'da_selling_records_v1'

let cachedModeId = null

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
 * Checks for public.selling_records first; if table does not exist,
 * falls back cleanly to Supabase audit_log + localStorage sync.
 */
export async function getSellingRecords() {
  // First check active parties to always have current names & balance
  const [{ data: parties }, { data: bsData }] = await Promise.all([
    supabase.from('parties').select('id, name').order('name'),
    supabase.rpc('fn_bill_status', { p_as_of: new Date().toISOString().split('T')[0] }).catch(() => ({ data: [] }))
  ])

  const partyMap = {}
  ;(parties || []).forEach(p => { partyMap[p.id] = p.name })

  // Party balance map
  const balanceMap = {}
  ;(bsData || []).forEach(b => {
    balanceMap[b.party_id] = (balanceMap[b.party_id] || 0) + Number(b.balance || 0)
  })

  // Try direct selling_records table in Supabase
  try {
    const { data, error } = await supabase
      .from('selling_records')
      .select('*, supplier:parties(id, name), payment:party_payments(id, amount, payment_date, reference_no, is_cancelled)')
      .order('selling_date', { ascending: false })

    if (!error && Array.isArray(data)) {
      return data.map(item => ({
        ...item,
        supplier_name: item.supplier?.name || partyMap[item.supplier_id] || 'Unknown Supplier',
        supplier_balance: balanceMap[item.supplier_id] || 0,
        is_payment_active: item.payment && !item.payment.is_cancelled,
      }))
    }
  } catch {
    // Continue to cloud audit_log + localStorage fallback
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
      // Because audit_log is ordered latest-first:
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

  const merged = Array.from(combinedMap.values()).map(item => ({
    ...item,
    supplier_name: partyMap[item.supplier_id] || item.supplier_name || 'Unknown Supplier',
    supplier_balance: balanceMap[item.supplier_id] || 0,
  }))

  // Save updated merged to localStorage for fast initial render
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(merged))
  } catch {}

  return merged.sort((a, b) => new Date(b.selling_date || b.created_at) - new Date(a.selling_date || a.created_at))
}

/**
 * Save (create or update) a selling record.
 * Handles entering / updating / deleting payment transactions in party_payments.
 */
export async function saveSellingRecord(record, isEdit = false) {
  const totalAmount = Number((Number(record.quantity) * Number(record.carat_rate)).toFixed(2))
  const today = new Date().toISOString().split('T')[0]
  const sellingDate = record.selling_date || today

  let paymentId = record.payment_id || null

  // 1. Manage payment transaction in party_payments based on payment_type switch
  if (record.payment_type === 'adjusted') {
    const modeId = await getSellingAdjustmentModeId()
    const paymentPayload = {
      party_id: record.supplier_id,
      payment_date: sellingDate,
      amount: totalAmount,
      mode_id: modeId,
      reference_no: `Sale: ${record.title || 'Diamond Sale'}`,
      remarks: `Selling balance adjustment: ${record.title} (${Number(record.quantity).toFixed(3)} ct @ ₹${Number(record.carat_rate).toLocaleString('en-IN')})`,
    }

    if (paymentId) {
      // Update existing payment
      const { error: updErr } = await supabase
        .from('party_payments')
        .update(paymentPayload)
        .eq('id', paymentId)
      
      if (updErr) {
        console.warn('Could not update payment, re-inserting:', updErr)
        // If updating failed (e.g. was deleted from payments table), insert fresh
        const { data: newPay } = await supabase
          .from('party_payments')
          .insert(paymentPayload)
          .select('id')
          .single()
        if (newPay) paymentId = newPay.id
      }
    } else {
      // Insert new payment transaction for this supplier
      const { data: newPay, error: insErr } = await supabase
        .from('party_payments')
        .insert(paymentPayload)
        .select('id')
        .single()
      
      if (insErr) {
        console.error('Failed to create payment transaction:', insErr)
        throw new Error('Failed to record payment transaction in supplier balance: ' + insErr.message)
      }
      if (newPay) paymentId = newPay.id
    }
  } else if (record.payment_type === 'collected') {
    // If switched to 'collected' and previously had a linked payment, delete it
    if (paymentId) {
      await supabase.from('party_payments').delete().eq('id', paymentId)
      paymentId = null
    }
  }

  const finalRecord = {
    ...record,
    id: record.id || crypto.randomUUID(),
    total_amount: totalAmount,
    selling_date: sellingDate,
    payment_id: paymentId,
    updated_at: new Date().toISOString(),
    created_at: record.created_at || new Date().toISOString(),
  }

  // 2. Persist selling record
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

    const { error: tblErr } = await supabase
      .from('selling_records')
      .upsert(tablePayload)
    
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
 * Delete a selling record and remove any linked payment transaction from party_payments.
 */
export async function deleteSellingRecord(record) {
  // 1. Delete linked payment if any
  if (record.payment_id) {
    try {
      await supabase.from('party_payments').delete().eq('id', record.payment_id)
    } catch (err) {
      console.warn('Failed to delete linked payment:', err)
    }
  }

  // 2. Delete from selling_records table if it exists
  try {
    await supabase.from('selling_records').delete().eq('id', record.id)
  } catch {}

  // 3. Mark deleted in audit_log
  try {
    await supabase.from('audit_log').insert({
      table_name: 'selling_portal',
      row_id: record.id,
      action: 'DELETE',
      old_data: { id: record.id },
    })
  } catch {}

  // 4. Remove from localStorage
  try {
    const local = localStorage.getItem(LOCAL_STORAGE_KEY)
    if (local) {
      const list = JSON.parse(local).filter(x => x.id !== record.id)
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(list))
    }
  } catch {}

  return true
}

/**
 * Quick toggle between 'collected' and 'adjusted' directly from table.
 */
export async function toggleSettlementMode(record) {
  const newType = record.payment_type === 'adjusted' ? 'collected' : 'adjusted'
  return await saveSellingRecord({
    ...record,
    payment_type: newType,
  }, true)
}
