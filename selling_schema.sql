-- =============================================================================
-- SELLING PORTAL SCHEMA EXTENSION
-- =============================================================================
-- Run this in your Supabase Dashboard -> SQL Editor if you want a dedicated
-- 'selling_records' table for the Selling Portal.
-- =============================================================================

-- 1. Ensure 'Selling Adjustment' payment mode exists
insert into public.payment_modes (name, counts_as_payment, needs_reference, sort_order)
values ('Selling Adjustment', true, false, 10)
on conflict (name) do nothing;

-- 2. Create selling_records table
create table if not exists public.selling_records (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  supplier_id    uuid not null references public.parties(id) on delete cascade,
  quantity       numeric(12,3) not null check (quantity > 0),
  carat_rate     numeric(14,2) not null check (carat_rate >= 0),
  total_amount   numeric(16,2) not null check (total_amount >= 0),
  selling_date   date not null default current_date,
  due_date       date not null,
  payment_type   text not null default 'collected' check (payment_type in ('collected', 'adjusted')),
  payment_id     uuid references public.party_payments(id) on delete set null,
  remarks        text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- 3. Trigger for updated_at
create trigger trg_selling_records_updated before update on public.selling_records
  for each row execute function public.set_updated_at();

-- 4. Enable RLS
alter table public.selling_records enable row level security;

-- 5. Policies (matching anon/authenticated access pattern)
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'selling_records' and policyname = 'selling_records_all') then
    create policy selling_records_all on public.selling_records for all to public using (true) with check (true);
  end if;
end $$;

