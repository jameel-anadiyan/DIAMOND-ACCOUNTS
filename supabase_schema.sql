-- =============================================================================
--  DIAMOND SUPPLIER PAYMENT TRACKER  ·  Supabase / PostgreSQL schema  ·  v1
-- -----------------------------------------------------------------------------
--  Run once on a fresh Supabase project:  Dashboard → SQL Editor → paste → Run.
--
--  Design rule: ALL money logic lives here, in the database.
--    • line amounts      → generated columns on purchase_invoice_lines
--    • invoice totals    → view  v_invoice_totals
--    • FIFO allocation   → functions fn_bills / fn_credits / fn_allocations
--    • bill status       → fn_bill_status     (view v_bill_status   = today)
--    • party summary,
--      flags + reasons   → fn_party_summary   (view v_party_summary = today)
--    • payment preview   → fn_preview_payment (what a new payment will clear)
--  The React app only READS these views/functions and WRITES the base tables.
--  Nothing about balances, status or flags is ever stored, so it can never go
--  stale: edit or delete any invoice/payment and every number re-flows.
--
--  Sections:  0 helpers · 1 masters · 2 transactions · 3 invoice totals ·
--             4 FIFO engine · 5 party summary + flags · 6 security (RLS) ·
--             7 audit log · 8 seed data
-- =============================================================================


-- =============================================================================
-- 0. HELPERS
-- =============================================================================

-- Keeps updated_at current on every UPDATE.
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Indian-style money text for reasons: 1234567.8 → '₹12,34,568'
-- (amounts under ₹100 keep their paise so a ₹0.20 leftover never shows as '₹0')
create or replace function public.fmt_inr(n numeric)
returns text language sql stable set search_path = public as $$
  select case when n is null then '₹0'
              else case when n < 0 then '-₹' else '₹' end ||
                   case when abs(n) < 100 and abs(n) <> trunc(abs(n))
                        then to_char(abs(n), 'FM990.00')
                        else to_char(round(abs(n)), 'FM99,99,99,99,99,990') end
         end
$$;

-- '1 bill' / '3 bills'
create or replace function public.fmt_bills(n int)
returns text language sql immutable set search_path = public as $$
  select n || case when n = 1 then ' bill' else ' bills' end
$$;

create or replace function public.fmt_d(d date)
returns text language sql stable set search_path = public as $$
  select to_char(d, 'DD-Mon-YYYY')
$$;


-- =============================================================================
-- 1. MASTERS
-- =============================================================================

-- 1.1 Settings (single row) – business rules you can tune without code changes
create table public.app_settings (
  id                    smallint primary key default 1 check (id = 1),
  company_name          text    not null default 'My Company',
  timezone              text    not null default 'Asia/Kolkata',  -- "today" is computed in this zone
  default_term_days     int     not null default 90  check (default_term_days >= 0),
  recent_payment_days   int     not null default 7   check (recent_payment_days between 1 and 60),
                                                    -- YELLOW if a payment was made within this many days
  due_soon_days         int     not null default 7   check (due_soon_days between 0 and 60),
  red_tier1_max_days    int     not null default 15, -- RED 1 Mild     :  1 – 15 days overdue
  red_tier2_max_days    int     not null default 30, -- RED 2 Serious  : 16 – 30
  red_tier3_max_days    int     not null default 60, -- RED 3 Severe   : 31 – 60   (RED 4 Critical: 61+)
  overdue_tolerance     numeric(14,2) not null default 100 check (overdue_tolerance >= 0),
                                                    -- overdue at or below this is ignored for the flag (rounding leftovers)
  updated_at            timestamptz not null default now(),
  constraint tiers_ascending check (0 < red_tier1_max_days
                                    and red_tier1_max_days < red_tier2_max_days
                                    and red_tier2_max_days < red_tier3_max_days)
);
create trigger trg_settings_updated before update on public.app_settings
  for each row execute function public.set_updated_at();

-- "Today" in the business time zone (Supabase servers run in UTC; without this,
-- between 00:00 and 05:30 IST the app would think it is still yesterday).
create or replace function public.app_today()
returns date language sql stable set search_path = public as $$
  select (now() at time zone coalesce((select timezone from public.app_settings where id = 1),
                                      'Asia/Kolkata'))::date
$$;

-- 1.2 Payment terms (credit days)
create table public.payment_terms (
  id          smallint generated always as identity primary key,
  days        int  not null unique check (days >= 0),
  description text,
  is_active   boolean not null default true
);

-- 1.3 Payment modes.  counts_as_payment = false for book adjustments (TDS,
--     discount/kasar, opening advance): they reduce the balance through FIFO
--     but do NOT count as "paid recently" when deciding YELLOW vs RED.
create table public.payment_modes (
  id                smallint generated always as identity primary key,
  name              text    not null unique,
  counts_as_payment boolean not null default true,
  needs_reference   boolean not null default false,   -- UTR / cheque no. required
  sort_order        int     not null default 0,
  is_active         boolean not null default true
);

-- 1.4 Tax rates (rate is copied onto each invoice, so changing the master
--     never alters old bills)
create table public.tax_rates (
  id           smallint generated always as identity primary key,
  name         text not null unique,
  rate_percent numeric(6,3) not null check (rate_percent between 0 and 100),
  is_default   boolean not null default false,
  is_active    boolean not null default true
);
create unique index tax_rates_one_default on public.tax_rates (is_default) where is_default;

-- 1.5 Units of weight
create table public.units (
  code      text primary key,          -- 'ct', 'gm'
  name      text not null,
  is_active boolean not null default true
);

-- 1.6 Brokers / C/O (the "C/O" person + phone from the Excel supplier master)
create table public.brokers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  phone      text,
  remarks    text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index brokers_name_ci on public.brokers (lower(name));
create trigger trg_brokers_updated before update on public.brokers
  for each row execute function public.set_updated_at();

-- 1.7 Items / quality (optional – e.g. "CVD polished", "Rough", size bands)
create table public.items (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  default_unit text not null default 'ct' references public.units(code),
  is_active    boolean not null default true
);
create unique index items_name_ci on public.items (lower(name));

-- 1.8 Our bank accounts (optional – "paid from")
create table public.bank_accounts (
  id        uuid primary key default gen_random_uuid(),
  name      text not null,                 -- e.g. 'HDFC CA ••1234'
  is_active boolean not null default true
);
create unique index bank_accounts_name_ci on public.bank_accounts (lower(name));

-- 1.9 Parties (suppliers)
create table public.parties (
  id                uuid primary key default gen_random_uuid(),
  code              text,                  -- short code, e.g. 'JEEYA'
  name              text not null,
  contact_person    text,
  phone             text,
  alt_phone         text,
  email             text,
  address           text,
  city              text,
  broker_id         uuid references public.brokers(id),
  gstin             text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  pan               text check (pan   is null or pan   ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  default_term_days int  not null default 90 check (default_term_days >= 0),
  is_active         boolean not null default true,
  remarks           text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index parties_name_ci on public.parties (lower(name));
create unique index parties_code_ci on public.parties (lower(code)) where code is not null;
create trigger trg_parties_updated before update on public.parties
  for each row execute function public.set_updated_at();


-- =============================================================================
-- 2. TRANSACTIONS
-- =============================================================================

-- 2.1 Purchase invoice (header).  bill_type:
--       PURCHASE – normal bill, amounts come from its lines
--       OPENING  – opening balance carried forward; amount typed directly,
--                  no lines (replaces the Excel "OPEN-xxx" rows with fake weights)
create table public.purchase_invoices (
  id               uuid primary key default gen_random_uuid(),
  entry_no         bigint generated always as identity unique,  -- entry order; FIFO tie-break
  party_id         uuid not null references public.parties(id),
  bill_type        text not null default 'PURCHASE' check (bill_type in ('PURCHASE','OPENING')),
  invoice_no       text not null,
  invoice_date     date not null,
  term_days        int  not null check (term_days >= 0),
  due_date         date generated always as (invoice_date + term_days) stored,
  fy_start_year    smallint generated always as (
                     (extract(year from invoice_date)
                      - case when extract(month from invoice_date) < 4 then 1 else 0 end)::smallint
                   ) stored,                                     -- Indian FY (Apr–Mar)
  tax_rate_percent numeric(6,3) not null default 1.5 check (tax_rate_percent between 0 and 100),
  round_off        numeric(10,2) not null default 0,
  opening_amount   numeric(14,2),                              -- only for OPENING
  remarks          text,
  is_cancelled     boolean not null default false,
  cancelled_reason text,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint opening_amount_rule check (
    (bill_type = 'OPENING'  and opening_amount is not null and opening_amount > 0)
    or (bill_type = 'PURCHASE' and opening_amount is null))
);
-- Same supplier cannot reuse an invoice number inside one financial year
-- (cancelled bills are ignored, so a number can be re-entered after cancelling).
create unique index purchase_invoices_no_uq
  on public.purchase_invoices (party_id, fy_start_year, upper(invoice_no))
  where not is_cancelled;
create index purchase_invoices_party_date on public.purchase_invoices (party_id, invoice_date);
create trigger trg_invoices_updated before update on public.purchase_invoices
  for each row execute function public.set_updated_at();

-- 2.2 Purchase invoice lines (one row per lot / rate).  All amounts are
--     generated by the database exactly like the Excel formulas:
--       Full Amount          = Weight × Rate
--       Sales Return Amount  = QC-out Weight × Rate
--       Taxable              = Full Amount − Sales Return Amount
--     (tax and line total are in v_invoice_totals because the tax % lives on the header)
create table public.purchase_invoice_lines (
  id                uuid primary key default gen_random_uuid(),
  invoice_id        uuid not null references public.purchase_invoices(id) on delete cascade,
  line_no           int  not null default 1,
  item_id           uuid references public.items(id),
  description       text,
  unit              text not null default 'ct' references public.units(code),
  weight            numeric(12,3) not null check (weight > 0),
  rate              numeric(14,2) not null check (rate >= 0),
  qc_return_weight  numeric(12,3) not null default 0 check (qc_return_weight >= 0),
  qc_return_date    date,
  qc_remarks        text,
  net_weight        numeric(12,3) generated always as (weight - qc_return_weight) stored,
  gross_amount      numeric(16,2) generated always as (round(weight * rate, 2)) stored,
  qc_return_amount  numeric(16,2) generated always as (round(qc_return_weight * rate, 2)) stored,
  taxable_amount    numeric(16,2) generated always as
                      (round(weight * rate, 2) - round(qc_return_weight * rate, 2)) stored,
  constraint qc_not_more_than_weight check (qc_return_weight <= weight),
  constraint line_no_unique unique (invoice_id, line_no)
);
create index purchase_invoice_lines_invoice on public.purchase_invoice_lines (invoice_id);

-- Lines are only allowed on PURCHASE bills.
create or replace function public.check_line_parent()
returns trigger language plpgsql set search_path = public as $$
begin
  if (select bill_type from public.purchase_invoices where id = new.invoice_id) <> 'PURCHASE' then
    raise exception 'Lines can only be added to PURCHASE bills (opening balances have no lines)';
  end if;
  return new;
end $$;
create trigger trg_line_parent before insert or update on public.purchase_invoice_lines
  for each row execute function public.check_line_parent();

-- 2.3 Party payments – recorded against the PARTY, never against an invoice.
--     The FIFO engine decides which bills each payment settles.
create table public.party_payments (
  id               uuid primary key default gen_random_uuid(),
  entry_no         bigint generated always as identity unique,  -- entry order; FIFO tie-break
  party_id         uuid not null references public.parties(id),
  payment_date     date not null,
  amount           numeric(14,2) not null check (amount > 0),
  mode_id          smallint not null references public.payment_modes(id),
  reference_no     text,                               -- UTR / cheque no.
  bank_account_id  uuid references public.bank_accounts(id),
  remarks          text,
  is_cancelled     boolean not null default false,
  cancelled_reason text,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index party_payments_party_date on public.party_payments (party_id, payment_date);
create trigger trg_payments_updated before update on public.party_payments
  for each row execute function public.set_updated_at();


-- =============================================================================
-- 3. INVOICE TOTALS  (the Excel columns F → K, per invoice)
-- =============================================================================
create view public.v_invoice_totals with (security_invoker = true) as
select
  i.id                                           as invoice_id,
  i.party_id,
  i.bill_type,
  i.invoice_no,
  i.invoice_date,
  i.term_days,
  i.due_date,
  i.fy_start_year,
  i.tax_rate_percent,
  i.round_off,
  i.is_cancelled,
  i.entry_no,
  i.remarks,
  count(l.id)::int                               as line_count,
  coalesce(sum(l.weight), 0)                     as total_weight,
  coalesce(sum(l.qc_return_weight), 0)           as qc_return_weight,
  coalesce(sum(l.net_weight), 0)                 as net_weight,
  coalesce(sum(l.gross_amount), 0)               as gross_amount,       -- "Full Amount"
  coalesce(sum(l.qc_return_amount), 0)           as qc_return_amount,   -- "Sales Return Amount"
  coalesce(sum(l.taxable_amount), 0)             as taxable_amount,
  coalesce(sum(round(l.taxable_amount * i.tax_rate_percent / 100, 2)), 0)
                                                 as tax_amount,         -- "Tax 1.5%"
  case when i.bill_type = 'OPENING' then i.opening_amount
       else coalesce(sum(l.taxable_amount + round(l.taxable_amount * i.tax_rate_percent / 100, 2)), 0)
            + i.round_off
  end                                            as net_payable         -- "Net Payable"
from public.purchase_invoices i
left join public.purchase_invoice_lines l on l.invoice_id = i.id
group by i.id;


-- =============================================================================
-- 4. FIFO ENGINE
-- -----------------------------------------------------------------------------
--  Think of each party as two queues laid end-to-end on a number line:
--    bills    (oldest first) occupy  [cum_start, cum_end)  of "amount owed"
--    payments (oldest first) occupy  [cum_start, cum_end)  of "amount paid"
--  Payment P settles bill B by exactly the overlap of their two ranges:
--    allocated = LEAST(B.cum_end, P.cum_end) − GREATEST(B.cum_start, P.cum_start)
--  This is pure FIFO, needs no loops, and re-computes instantly after any edit.
--  p_as_of: only bills/payments dated on or before this date are counted
--  (a payment dated tomorrow is "scheduled" and does not count yet).
-- =============================================================================

-- 4.1 Bills in FIFO order: oldest bill date first; on the same date the opening
--     balance first, then earlier due date, then the order the bills were entered
create or replace function public.fn_bills(p_as_of date default public.app_today())
returns table (
  party_id uuid, invoice_id uuid, bill_type text, bill_no text, bill_date date,
  due_date date, term_days int, amount numeric, fifo_seq bigint,
  cum_start numeric, cum_end numeric)
language sql stable set search_path = public as $$
  with o as (
    select t.party_id, t.invoice_id, t.bill_type, t.invoice_no, t.invoice_date, t.due_date,
           t.term_days, t.net_payable,
           row_number() over (
             partition by t.party_id
             order by t.invoice_date,
                      case t.bill_type when 'OPENING' then 0 else 1 end,
                      t.due_date, t.entry_no) as fifo_seq
    from public.v_invoice_totals t
    where not t.is_cancelled
      and t.net_payable > 0
      and t.invoice_date <= p_as_of
  )
  select o.party_id, o.invoice_id, o.bill_type, o.invoice_no, o.invoice_date, o.due_date,
         o.term_days, o.net_payable, o.fifo_seq,
         sum(o.net_payable) over w - o.net_payable,
         sum(o.net_payable) over w
  from o
  window w as (partition by o.party_id order by o.fifo_seq
               rows between unbounded preceding and current row)
$$;

-- 4.2 Credits (payments + adjustments) in FIFO order: oldest payment date first,
--     then the order they were entered
create or replace function public.fn_credits(p_as_of date default public.app_today())
returns table (
  party_id uuid, payment_id uuid, payment_date date, amount numeric,
  mode_name text, counts_as_payment boolean, reference_no text, fifo_seq bigint,
  cum_start numeric, cum_end numeric)
language sql stable set search_path = public as $$
  with o as (
    select pp.party_id, pp.id as payment_id, pp.payment_date, pp.amount, m.name as mode_name,
           m.counts_as_payment, pp.reference_no,
           row_number() over (partition by pp.party_id
                              order by pp.payment_date, pp.entry_no) as fifo_seq
    from public.party_payments pp
    join public.payment_modes m on m.id = pp.mode_id
    where not pp.is_cancelled
      and pp.payment_date <= p_as_of
  )
  select o.party_id, o.payment_id, o.payment_date, o.amount, o.mode_name, o.counts_as_payment,
         o.reference_no, o.fifo_seq,
         sum(o.amount) over w - o.amount,
         sum(o.amount) over w
  from o
  window w as (partition by o.party_id order by o.fifo_seq
               rows between unbounded preceding and current row)
$$;

-- 4.3 Which payment settled which bill, and by how much
create or replace function public.fn_allocations(p_as_of date default public.app_today())
returns table (
  party_id uuid, invoice_id uuid, bill_no text, bill_date date, due_date date,
  payment_id uuid, payment_date date, mode_name text, allocated numeric)
language sql stable set search_path = public as $$
  select b.party_id, b.invoice_id, b.bill_no, b.bill_date, b.due_date,
         c.payment_id, c.payment_date, c.mode_name,
         least(b.cum_end, c.cum_end) - greatest(b.cum_start, c.cum_start)
  from public.fn_bills(p_as_of) b
  join public.fn_credits(p_as_of) c
    on c.party_id = b.party_id
   and c.cum_start < b.cum_end
   and c.cum_end   > b.cum_start
$$;

-- 4.4 Status of every bill (Paid / Part Paid / Unpaid) after FIFO
create or replace function public.fn_bill_status(p_as_of date default public.app_today())
returns table (
  party_id uuid, invoice_id uuid, bill_type text, bill_no text, bill_date date,
  due_date date, term_days int, amount numeric, fifo_seq bigint,
  paid numeric, balance numeric, status text,
  is_overdue boolean, days_overdue int, days_to_due int,
  paid_on date, payments_applied int)
language sql stable set search_path = public as $$
  with b  as (select * from public.fn_bills(p_as_of)),
       c  as (select * from public.fn_credits(p_as_of)),
       tc as (select c.party_id, sum(c.amount) as total_credit from c group by c.party_id),
       al as (select b.invoice_id, max(c.payment_date) as last_payment_date, count(*) as n
              from b join c on c.party_id = b.party_id
                           and c.cum_start < b.cum_end and c.cum_end > b.cum_start
              group by b.invoice_id)
  select b.party_id, b.invoice_id, b.bill_type, b.bill_no, b.bill_date, b.due_date, b.term_days,
         b.amount, b.fifo_seq,
         x.paid,
         b.amount - x.paid,
         case when x.paid >= b.amount then 'PAID'
              when x.paid > 0          then 'PART_PAID'
              else 'UNPAID' end,
         (b.amount - x.paid) > 0 and b.due_date < p_as_of,
         case when (b.amount - x.paid) > 0 and b.due_date < p_as_of then p_as_of - b.due_date end,
         b.due_date - p_as_of,
         case when x.paid >= b.amount then al.last_payment_date end,
         coalesce(al.n, 0)::int
  from b
  left join tc on tc.party_id = b.party_id
  left join al on al.invoice_id = b.invoice_id
  cross join lateral (
    select least(b.amount, greatest(0, coalesce(tc.total_credit, 0) - b.cum_start)) as paid
  ) x
$$;

-- 4.5 Payment preview: "if I pay this party ₹X today, which bills get cleared?"
--     Returns open bills in FIFO order + an ADVANCE row for any excess.
create or replace function public.fn_preview_payment(
  p_party_id uuid, p_amount numeric, p_as_of date default public.app_today())
returns table (
  fifo_seq bigint, invoice_id uuid, bill_no text, bill_date date, due_date date,
  balance_before numeric, applied numeric, balance_after numeric,
  status_after text, was_overdue boolean)
language sql stable set search_path = public as $$
  with open_bills as (
    select bs.*, sum(bs.balance) over (order by bs.fifo_seq) - bs.balance as cum_before
    from public.fn_bill_status(p_as_of) bs
    where bs.party_id = p_party_id and bs.balance > 0
  ),
  applied as (
    select ob.*, least(ob.balance, greatest(0, p_amount - ob.cum_before)) as applied
    from open_bills ob
  )
  select a.fifo_seq, a.invoice_id, a.bill_no, a.bill_date, a.due_date,
         a.balance, a.applied, a.balance - a.applied,
         case when a.applied >= a.balance then 'PAID'
              when a.applied > 0 or a.paid > 0 then 'PART_PAID'
              else 'UNPAID' end,
         a.is_overdue
  from applied a
  union all
  select null, null, 'ADVANCE (excess, adjusts against next bill)', null, null,
         0, x.excess, 0, 'ADVANCE', false
  from (select p_amount - coalesce((select sum(balance) from open_bills), 0) as excess) x
  where x.excess > 0
  order by 1 nulls last
$$;


-- 4.6 Party statement (ledger) with running balance – bills increase what we
--     owe, payments/adjustments reduce it.  p_from = null → from the beginning.
create or replace function public.fn_party_ledger(
  p_party_id uuid, p_from date default null, p_to date default public.app_today())
returns table (
  line_no bigint, entry_date date, entry_type text, ref_no text, particulars text,
  bill_amount numeric, paid_amount numeric, running_balance numeric)
language sql stable set search_path = public as $$
  with e as (
    select t.invoice_date as d, 1 as k, t.entry_no as n,
           case t.bill_type when 'OPENING' then 'OPENING' else 'BILL' end as entry_type,
           t.invoice_no as ref_no,
           case t.bill_type when 'OPENING' then 'Opening balance'
                else concat('Purchase ', t.total_weight, ' ct',
                            case when t.qc_return_weight > 0 then concat(', QC return ', t.qc_return_weight, ' ct') end,
                            ', due ', public.fmt_d(t.due_date)) end as particulars,
           t.net_payable as bill_amount, 0::numeric as paid_amount
    from public.v_invoice_totals t
    where t.party_id = p_party_id and not t.is_cancelled and t.net_payable <> 0 and t.invoice_date <= p_to
    union all
    select pp.payment_date, 2, pp.entry_no, 'PAYMENT', pp.reference_no,
           concat(m.name, case when pp.remarks is not null then ' – ' || pp.remarks end),
           0, pp.amount
    from public.party_payments pp
    join public.payment_modes m on m.id = pp.mode_id
    where pp.party_id = p_party_id and not pp.is_cancelled and pp.payment_date <= p_to
  ),
  r as (
    select e.*, sum(e.bill_amount - e.paid_amount)
                  over (order by e.d, e.k, e.n rows between unbounded preceding and current row) as bal
    from e
  ),
  x as (
    select p_from as d, 0 as k, 0::bigint as n, 'B/F'::text as entry_type, null::text as ref_no,
           'Balance brought forward'::text as particulars, null::numeric as bill_amount,
           null::numeric as paid_amount,
           coalesce((select r.bal from r where r.d < p_from order by r.d desc, r.k desc, r.n desc limit 1), 0) as bal
    where p_from is not null
    union all
    select r.d, r.k, r.n, r.entry_type, r.ref_no, r.particulars, r.bill_amount, r.paid_amount, r.bal
    from r where p_from is null or r.d >= p_from
  )
  select row_number() over (order by x.d, x.k, x.n), x.d, x.entry_type, x.ref_no, x.particulars,
         x.bill_amount, x.paid_amount, x.bal
  from x
  order by x.d, x.k, x.n
$$;


-- =============================================================================
-- 5. PARTY SUMMARY + FLAGS  (the Excel dashboard, per party, plus the flag)
-- -----------------------------------------------------------------------------
--  Flag rules (evaluated "as of" a date, normally today):
--    GREEN  : nothing overdue (overdue ≤ tolerance).
--    YELLOW : something overdue, BUT a real payment (counts_as_payment) was
--             made within the last recent_payment_days (default 7) days.
--    RED    : something overdue AND no real payment in the last 7 days.
--             Strength of red = days the OLDEST unpaid overdue bill is overdue
--             (ignoring a bill with only a rounding leftover ≤ tolerance on it):
--               RED 1 Mild 1–15 · RED 2 Serious 16–30 · RED 3 Severe 31–60 ·
--               RED 4 Critical 61+          (thresholds live in app_settings)
--    "Paid recently" means: days since the last real payment ≤ 7, i.e. a
--    payment on 24-Sep keeps a party YELLOW up to 01-Oct; RED from 02-Oct.
--  "Overdue" is measured AFTER FIFO, so an over-payment on an old bill can never
--  hide (or offset) a newer overdue bill the way SUMIFS did in the Excel.
-- =============================================================================

create or replace function public.fn_party_summary(p_as_of date default public.app_today())
returns table (
  as_of_date date,
  party_id uuid, party_name text, party_code text, city text, broker_name text, is_active boolean,
  -- purchases (Excel dashboard columns)
  purchase_bills int, total_weight numeric, qc_return_weight numeric, qc_return_pct numeric,
  gross_amount numeric, qc_return_amount numeric, tax_amount numeric,
  opening_amount numeric, purchase_net numeric, total_payable numeric,
  -- payments
  total_paid numeric, total_adjusted numeric, total_settled numeric,
  balance numeric, outstanding numeric, advance numeric,
  -- due position after FIFO
  open_bills int, overdue_amount numeric, overdue_bills int,
  oldest_overdue_bill text, oldest_overdue_due date, oldest_overdue_balance numeric,
  max_days_overdue int,
  not_due_amount numeric, aging_1 numeric, aging_2 numeric, aging_3 numeric, aging_4 numeric,
  due_soon_amount numeric, next_due_date date, next_due_amount numeric, next_due_bills text,
  -- payment behaviour
  last_payment_date date, last_payment_amount numeric, days_since_last_payment int,
  paid_in_window numeric, scheduled_amount numeric, next_scheduled_date date,
  -- flag
  flag text, red_tier int, flag_label text, flag_color text,
  turns_red_on date, next_tier_on date, flag_reason text, priority_rank int)
language sql stable set search_path = public as $$
with s as (select * from public.app_settings where id = 1),
bs as (select * from public.fn_bill_status(p_as_of)),
inv as (
  select t.party_id,
         count(*) filter (where t.bill_type = 'PURCHASE')            as purchase_bills,
         sum(t.total_weight)                                         as total_weight,
         sum(t.qc_return_weight)                                     as qc_return_weight,
         sum(t.gross_amount)                                         as gross_amount,
         sum(t.qc_return_amount)                                     as qc_return_amount,
         sum(t.tax_amount)                                           as tax_amount,
         sum(t.net_payable) filter (where t.bill_type = 'OPENING')   as opening_amount,
         sum(t.net_payable) filter (where t.bill_type = 'PURCHASE')  as purchase_net
  from public.v_invoice_totals t
  where not t.is_cancelled and t.invoice_date <= p_as_of
  group by t.party_id
),
pay as (
  select pp.party_id,
         sum(pp.amount) filter (where m.counts_as_payment)            as total_paid,
         sum(pp.amount) filter (where not m.counts_as_payment)        as total_adjusted,
         max(pp.payment_date) filter (where m.counts_as_payment)      as last_payment_date
  from public.party_payments pp
  join public.payment_modes m on m.id = pp.mode_id
  where not pp.is_cancelled and pp.payment_date <= p_as_of
  group by pp.party_id
),
lastpay as (
  select pp.party_id, sum(pp.amount) as last_payment_amount
  from public.party_payments pp
  join public.payment_modes m on m.id = pp.mode_id
  join pay on pay.party_id = pp.party_id and pp.payment_date = pay.last_payment_date
  where not pp.is_cancelled and m.counts_as_payment
  group by pp.party_id
),
recent as (
  select pp.party_id, sum(pp.amount) as paid_in_window
  from public.party_payments pp
  join public.payment_modes m on m.id = pp.mode_id
  cross join s
  where not pp.is_cancelled and m.counts_as_payment
    and pp.payment_date <= p_as_of
    and pp.payment_date >= p_as_of - s.recent_payment_days
  group by pp.party_id
),
sched as (
  select pp.party_id, sum(pp.amount) as scheduled_amount, min(pp.payment_date) as next_scheduled_date
  from public.party_payments pp
  where not pp.is_cancelled and pp.payment_date > p_as_of
  group by pp.party_id
),
agg as (
  select bs.party_id,
         sum(bs.balance)                                                        as outstanding,
         count(*) filter (where bs.balance > 0)                                 as open_bills,
         sum(bs.balance) filter (where bs.is_overdue)                           as overdue_amount,
         count(*) filter (where bs.is_overdue)                                  as overdue_bills,
         sum(bs.balance) filter (where bs.balance > 0 and not bs.is_overdue)    as not_due_amount,
         sum(bs.balance) filter (where bs.days_overdue between 1 and s.red_tier1_max_days)            as aging_1,
         sum(bs.balance) filter (where bs.days_overdue between s.red_tier1_max_days + 1 and s.red_tier2_max_days) as aging_2,
         sum(bs.balance) filter (where bs.days_overdue between s.red_tier2_max_days + 1 and s.red_tier3_max_days) as aging_3,
         sum(bs.balance) filter (where bs.days_overdue > s.red_tier3_max_days)                        as aging_4,
         sum(bs.balance) filter (where bs.balance > 0 and bs.due_date between p_as_of and p_as_of + s.due_soon_days)
                                                                                as due_soon_amount,
         min(bs.due_date) filter (where bs.balance > 0 and bs.due_date >= p_as_of) as next_due_date
  from bs cross join s
  group by bs.party_id
),
oldest as (
  -- oldest overdue bill that still has a real balance (> tolerance); a few paise
  -- left on an old bill must not push the party into a darker red
  select distinct on (bs.party_id) bs.party_id, bs.bill_no, bs.balance, bs.due_date
  from bs cross join s
  where bs.is_overdue
  order by bs.party_id, (bs.balance > s.overdue_tolerance) desc, bs.due_date, bs.fifo_seq
),
nextdue as (
  select bs.party_id, sum(bs.balance) as amt,
         string_agg(bs.bill_no, ', ' order by bs.fifo_seq) as bills
  from bs join agg on agg.party_id = bs.party_id and bs.due_date = agg.next_due_date
  where bs.balance > 0
  group by bs.party_id
),
base as (
  select p.id as party_id, p.name as party_name, p.code as party_code, p.city, br.name as broker_name,
         p.is_active,
         coalesce(inv.purchase_bills, 0)::int                            as purchase_bills,
         coalesce(inv.total_weight, 0)                                   as total_weight,
         coalesce(inv.qc_return_weight, 0)                               as qc_return_weight,
         case when coalesce(inv.total_weight, 0) > 0
              then round(100 * inv.qc_return_weight / inv.total_weight, 2) end as qc_return_pct,
         coalesce(inv.gross_amount, 0)                                   as gross_amount,
         coalesce(inv.qc_return_amount, 0)                               as qc_return_amount,
         coalesce(inv.tax_amount, 0)                                     as tax_amount,
         coalesce(inv.opening_amount, 0)                                 as opening_amount,
         coalesce(inv.purchase_net, 0)                                   as purchase_net,
         coalesce(inv.opening_amount, 0) + coalesce(inv.purchase_net, 0) as total_payable,
         coalesce(pay.total_paid, 0)                                     as total_paid,
         coalesce(pay.total_adjusted, 0)                                 as total_adjusted,
         coalesce(pay.total_paid, 0) + coalesce(pay.total_adjusted, 0)   as total_settled,
         coalesce(agg.outstanding, 0)                                    as outstanding,
         coalesce(agg.open_bills, 0)::int                                as open_bills,
         coalesce(agg.overdue_amount, 0)                                 as overdue_amount,
         coalesce(agg.overdue_bills, 0)::int                             as overdue_bills,
         oldest.bill_no                                                  as oldest_overdue_bill,
         oldest.due_date                                                 as oldest_overdue_due,
         oldest.balance                                                  as oldest_overdue_balance,
         (p_as_of - oldest.due_date)::int                                as max_days_overdue,
         coalesce(agg.not_due_amount, 0)                                 as not_due_amount,
         coalesce(agg.aging_1, 0) as aging_1, coalesce(agg.aging_2, 0) as aging_2,
         coalesce(agg.aging_3, 0) as aging_3, coalesce(agg.aging_4, 0) as aging_4,
         coalesce(agg.due_soon_amount, 0)                                as due_soon_amount,
         agg.next_due_date,
         nextdue.amt                                                     as next_due_amount,
         nextdue.bills                                                   as next_due_bills,
         pay.last_payment_date,
         lastpay.last_payment_amount,
         (p_as_of - pay.last_payment_date)::int                          as days_since_last_payment,
         coalesce(recent.paid_in_window, 0)                              as paid_in_window,
         coalesce(sched.scheduled_amount, 0)                             as scheduled_amount,
         sched.next_scheduled_date,
         s.recent_payment_days, s.due_soon_days, s.overdue_tolerance,
         s.red_tier1_max_days, s.red_tier2_max_days, s.red_tier3_max_days
  from public.parties p
  cross join s
  left join public.brokers br on br.id = p.broker_id
  left join inv     on inv.party_id     = p.id
  left join pay     on pay.party_id     = p.id
  left join lastpay on lastpay.party_id = p.id
  left join recent  on recent.party_id  = p.id
  left join sched   on sched.party_id   = p.id
  left join agg     on agg.party_id     = p.id
  left join oldest  on oldest.party_id  = p.id
  left join nextdue on nextdue.party_id = p.id
),
flagged as (
  select b.*,
         b.total_payable - b.total_settled                         as balance,
         greatest(0, b.total_settled - b.total_payable)            as advance,
         case when b.overdue_amount <= b.overdue_tolerance                          then 'GREEN'
              when b.days_since_last_payment is not null
               and b.days_since_last_payment <= b.recent_payment_days              then 'YELLOW'
              else 'RED' end                                       as flag
  from base b
),
tiered as (
  select f.*,
         case when f.flag <> 'RED' then null
              when f.max_days_overdue <= f.red_tier1_max_days then 1
              when f.max_days_overdue <= f.red_tier2_max_days then 2
              when f.max_days_overdue <= f.red_tier3_max_days then 3
              else 4 end                                           as red_tier
  from flagged f
),
labelled as (
  select t.*,
         case t.flag when 'GREEN'  then 'GREEN'
                     when 'YELLOW' then 'YELLOW'
                     else 'RED ' || t.red_tier || ' · ' ||
                          (array['Mild','Serious','Severe','Critical'])[t.red_tier] end as flag_label,
         case t.flag when 'GREEN'  then '#16A34A'
                     when 'YELLOW' then '#EAB308'
                     else (array['#F87171','#DC2626','#991B1B','#450A0A'])[t.red_tier] end as flag_color,
         case when t.flag = 'YELLOW'
              then t.last_payment_date + t.recent_payment_days + 1 end                as turns_red_on,
         case when t.flag = 'RED' and t.red_tier = 1 then t.oldest_overdue_due + t.red_tier1_max_days + 1
              when t.flag = 'RED' and t.red_tier = 2 then t.oldest_overdue_due + t.red_tier2_max_days + 1
              when t.flag = 'RED' and t.red_tier = 3 then t.oldest_overdue_due + t.red_tier3_max_days + 1
         end                                                                          as next_tier_on,
         (array[ '1–' || t.red_tier1_max_days,
                 (t.red_tier1_max_days + 1) || '–' || t.red_tier2_max_days,
                 (t.red_tier2_max_days + 1) || '–' || t.red_tier3_max_days,
                 (t.red_tier3_max_days + 1) || '+' ])[t.red_tier]                   as tier_band
  from tiered t
)
select
  p_as_of,
  l.party_id, l.party_name, l.party_code, l.city, l.broker_name, l.is_active,
  l.purchase_bills, l.total_weight, l.qc_return_weight, l.qc_return_pct,
  l.gross_amount, l.qc_return_amount, l.tax_amount,
  l.opening_amount, l.purchase_net, l.total_payable,
  l.total_paid, l.total_adjusted, l.total_settled,
  l.balance, l.outstanding, l.advance,
  l.open_bills, l.overdue_amount, l.overdue_bills,
  l.oldest_overdue_bill, l.oldest_overdue_due, l.oldest_overdue_balance, l.max_days_overdue,
  l.not_due_amount, l.aging_1, l.aging_2, l.aging_3, l.aging_4,
  l.due_soon_amount, l.next_due_date, l.next_due_amount, l.next_due_bills,
  l.last_payment_date, l.last_payment_amount, l.days_since_last_payment,
  l.paid_in_window, l.scheduled_amount, l.next_scheduled_date,
  l.flag, l.red_tier, l.flag_label, l.flag_color, l.turns_red_on, l.next_tier_on,
  -- ---------------- reason text (one paragraph, shown in the flag panel) ----------------
  concat_ws(' ',
    case
      -- GREEN -----------------------------------------------------------------
      when l.flag = 'GREEN' and l.total_payable = 0 and l.total_settled = 0 then
        'GREEN – No bills or payments recorded yet.'
      when l.flag = 'GREEN' and l.outstanding = 0 and l.advance = 0 then
        concat_ws(' ', 'GREEN – Fully settled: every bill is paid and nothing is due.',
          case when l.last_payment_date is not null then
            format('Last payment %s on %s.', public.fmt_inr(l.last_payment_amount), public.fmt_d(l.last_payment_date)) end)
      when l.flag = 'GREEN' and l.outstanding = 0 then
        format('GREEN – Fully settled, and %s has been paid in excess (advance). FIFO will adjust it automatically against the next bill.',
               public.fmt_inr(l.advance))
      when l.flag = 'GREEN' then
        concat_ws(' ',
          case when l.overdue_amount > 0 then
            format('GREEN – %s outstanding on %s. Only %s of it is past due, which is within the %s rounding tolerance, so it is ignored for the flag.',
                   public.fmt_inr(l.outstanding), public.fmt_bills(l.open_bills),
                   public.fmt_inr(l.overdue_amount), public.fmt_inr(l.overdue_tolerance))
          else
            format('GREEN – %s outstanding on %s, but none is past its due date.',
                   public.fmt_inr(l.outstanding), public.fmt_bills(l.open_bills)) end,
          case when l.next_due_date is not null then
            format('Next due: %s on %s (%s) – bill %s. Pay it by %s to stay GREEN.',
                   public.fmt_inr(l.next_due_amount), public.fmt_d(l.next_due_date),
                   case when l.next_due_date = p_as_of then 'today'
                        when l.next_due_date = p_as_of + 1 then 'tomorrow'
                        else 'in ' || (l.next_due_date - p_as_of) || ' days' end,
                   l.next_due_bills, public.fmt_d(l.next_due_date)) end,
          case when l.due_soon_amount > coalesce(l.next_due_amount, 0) then
            format('In total %s falls due within the next %s days.', public.fmt_inr(l.due_soon_amount), l.due_soon_days) end)
      -- YELLOW ----------------------------------------------------------------
      when l.flag = 'YELLOW' then
        concat_ws(' ',
          format('YELLOW – %s is overdue on %s. Oldest: bill %s, due %s (%s days overdue), %s still unpaid on it.',
                 public.fmt_inr(l.overdue_amount), public.fmt_bills(l.overdue_bills), l.oldest_overdue_bill,
                 public.fmt_d(l.oldest_overdue_due), l.max_days_overdue, public.fmt_inr(l.oldest_overdue_balance)),
          format('Not RED because a payment was made within the last %s days: %s on %s (%s).',
                 l.recent_payment_days, public.fmt_inr(l.last_payment_amount), public.fmt_d(l.last_payment_date),
                 case l.days_since_last_payment when 0 then 'today' when 1 then 'yesterday'
                      else l.days_since_last_payment || ' days ago' end),
          case when l.paid_in_window > l.last_payment_amount then
            format('%s paid in total during the last %s days.', public.fmt_inr(l.paid_in_window), l.recent_payment_days) end,
          format('Turns RED on %s unless another payment is made by %s.',
                 public.fmt_d(l.turns_red_on), public.fmt_d(l.turns_red_on - 1)),
          format('Pay %s to clear all overdue and turn GREEN.', public.fmt_inr(l.overdue_amount)))
      -- RED -------------------------------------------------------------------
      else
        concat_ws(' ',
          format('%s – %s is overdue on %s and nothing has been paid in the last %s days.',
                 l.flag_label, public.fmt_inr(l.overdue_amount), public.fmt_bills(l.overdue_bills), l.recent_payment_days),
          format('Strength: the oldest overdue bill (%s, due %s) is %s days overdue, which is in the RED %s band (%s days); %s is still unpaid on it.',
                 l.oldest_overdue_bill, public.fmt_d(l.oldest_overdue_due), l.max_days_overdue,
                 l.red_tier, l.tier_band, public.fmt_inr(l.oldest_overdue_balance)),
          case when l.last_payment_date is null then 'No payment has ever been recorded for this party.'
               else format('Last payment: %s on %s (%s days ago).', public.fmt_inr(l.last_payment_amount),
                           public.fmt_d(l.last_payment_date), l.days_since_last_payment) end,
          case when l.next_tier_on is not null then
            format('Becomes RED %s on %s if that bill is still unpaid.', l.red_tier + 1, public.fmt_d(l.next_tier_on)) end,
          format('Any bank/cash payment today turns it YELLOW for %s days;', l.recent_payment_days),
          case when l.overdue_bills > 1 then
            format('paying %s clears the oldest bill; paying %s clears all overdue and turns it GREEN.',
                   public.fmt_inr(l.oldest_overdue_balance), public.fmt_inr(l.overdue_amount))
          else format('paying %s clears it and turns it GREEN.', public.fmt_inr(l.overdue_amount)) end)
    end,
    case when l.scheduled_amount > 0 then
      format('Scheduled payment: %s dated %s – it will count from that date.',
             public.fmt_inr(l.scheduled_amount), public.fmt_d(l.next_scheduled_date)) end
  ) as flag_reason,
  -- ---------------- who to pay next ----------------
  row_number() over (
    order by case l.flag when 'RED' then 1 when 'YELLOW' then 2 else 3 end,
             l.red_tier desc nulls last,
             l.max_days_overdue desc nulls last,
             l.overdue_amount desc,
             l.next_due_date asc nulls last,
             l.outstanding desc,
             l.party_name)::int as priority_rank
from labelled l
$$;

-- Dashboard KPI row (sums of the party summary)
create or replace function public.fn_dashboard_totals(p_as_of date default public.app_today())
returns table (
  as_of_date date, parties int, opening_amount numeric, gross_amount numeric, qc_return_amount numeric,
  tax_amount numeric, purchase_net numeric, total_payable numeric, total_paid numeric,
  total_adjusted numeric, outstanding numeric, overdue_amount numeric, advance numeric,
  due_soon_amount numeric, total_weight numeric, qc_return_weight numeric,
  red_parties int, yellow_parties int, green_parties int)
language sql stable set search_path = public as $$
  select p_as_of, count(*)::int,
         sum(opening_amount), sum(gross_amount), sum(qc_return_amount), sum(tax_amount),
         sum(purchase_net), sum(total_payable), sum(total_paid), sum(total_adjusted),
         sum(outstanding), sum(overdue_amount), sum(advance), sum(due_soon_amount),
         sum(total_weight), sum(qc_return_weight),
         count(*) filter (where flag = 'RED')::int,
         count(*) filter (where flag = 'YELLOW')::int,
         count(*) filter (where flag = 'GREEN')::int
  from public.fn_party_summary(p_as_of)
  where is_active
$$;

-- "Today" views – what the React app reads most of the time
create view public.v_party_summary  with (security_invoker = true) as
  select * from public.fn_party_summary(public.app_today());
create view public.v_dashboard_totals with (security_invoker = true) as
  select * from public.fn_dashboard_totals(public.app_today());
create view public.v_bill_status    with (security_invoker = true) as
  select bs.*, p.name as party_name
  from public.fn_bill_status(public.app_today()) bs
  join public.parties p on p.id = bs.party_id;
create view public.v_payment_allocations with (security_invoker = true) as
  select * from public.fn_allocations(public.app_today());

-- Purchase register: every invoice incl. cancelled / nil / future-dated, with FIFO status
create view public.v_invoices with (security_invoker = true) as
select t.*, p.name as party_name,
       bs.paid, coalesce(bs.balance, case when t.is_cancelled or t.net_payable = 0 then 0 else t.net_payable end) as balance,
       case when t.is_cancelled            then 'CANCELLED'
            when t.net_payable = 0         then 'NIL'         -- fully returned in QC
            when bs.status is null         then 'UPCOMING'    -- dated in the future
            else bs.status end                         as status,
       bs.is_overdue, bs.days_overdue, bs.days_to_due, bs.paid_on, bs.fifo_seq
from public.v_invoice_totals t
join public.parties p on p.id = t.party_id
left join public.fn_bill_status(public.app_today()) bs on bs.invoice_id = t.invoice_id;

-- Payment register with mode and party name
create view public.v_payments with (security_invoker = true) as
select pp.*, p.name as party_name, m.name as mode_name, m.counts_as_payment,
       (pp.payment_date > public.app_today()) as is_scheduled
from public.party_payments pp
join public.parties p on p.id = pp.party_id
join public.payment_modes m on m.id = pp.mode_id;


-- =============================================================================
-- 6. SECURITY – Supabase Auth + roles + Row Level Security
--    admin    : everything incl. settings, users, delete
--    accounts : add/edit masters, invoices, payments (no delete, no settings)
--    viewer   : read-only (dashboard, reports)
--    pending  : signed up but not approved yet – sees nothing
--    The first user who signs up becomes admin automatically; everyone after
--    that is 'pending' until an admin gives them a role.
-- =============================================================================
create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text,
  role       text not null default 'pending' check (role in ('admin','accounts','viewer','pending')),
  created_at timestamptz not null default now()
);

create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id,
          coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
          case when exists (select 1 from public.profiles) then 'pending' else 'admin' end);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Enable RLS everywhere
alter table public.app_settings           enable row level security;
alter table public.payment_terms          enable row level security;
alter table public.payment_modes          enable row level security;
alter table public.tax_rates              enable row level security;
alter table public.units                  enable row level security;
alter table public.brokers                enable row level security;
alter table public.items                  enable row level security;
alter table public.bank_accounts          enable row level security;
alter table public.parties                enable row level security;
alter table public.purchase_invoices      enable row level security;
alter table public.purchase_invoice_lines enable row level security;
alter table public.party_payments         enable row level security;
alter table public.profiles               enable row level security;

-- Read: admin/accounts/viewer.  Write: admin/accounts.  Delete: admin.  Pending: nothing.
do $$
declare t text;
begin
  foreach t in array array['payment_terms','payment_modes','tax_rates','units','brokers','items',
                           'bank_accounts','parties','purchase_invoices','purchase_invoice_lines',
                           'party_payments']
  loop
    execute format('create policy %I on public.%I for select to authenticated using (public.my_role() in (''admin'',''accounts'',''viewer''))', t || '_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.my_role() in (''admin'',''accounts''))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.my_role() in (''admin'',''accounts'')) with check (public.my_role() in (''admin'',''accounts''))', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.my_role() = ''admin'')', t || '_delete', t);
  end loop;
end $$;

create policy app_settings_read   on public.app_settings for select to authenticated using (public.my_role() in ('admin','accounts','viewer'));
create policy app_settings_update on public.app_settings for update to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

create policy profiles_read   on public.profiles for select to authenticated
  using (id = auth.uid() or public.my_role() = 'admin');
create policy profiles_update on public.profiles for update to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

-- Functions: signed-in users only (anon gets nothing)
revoke execute on all functions in schema public from public, anon;
grant  execute on all functions in schema public to authenticated;


-- =============================================================================
-- 7. AUDIT LOG – who changed which invoice / payment / party, before and after
-- =============================================================================
create table public.audit_log (
  id         bigint generated always as identity primary key,
  table_name text not null,
  row_id     text,
  action     text not null,          -- INSERT / UPDATE / DELETE
  old_data   jsonb,
  new_data   jsonb,
  changed_by uuid default auth.uid(),
  changed_at timestamptz not null default now()
);
alter table public.audit_log enable row level security;
create policy audit_read on public.audit_log for select to authenticated using (public.my_role() = 'admin');

create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_log (table_name, row_id, action, old_data, new_data)
  values (tg_table_name,
          coalesce(to_jsonb(new) ->> 'id', to_jsonb(old) ->> 'id'),
          tg_op,
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

create trigger trg_audit_invoices after insert or update or delete on public.purchase_invoices
  for each row execute function public.audit_row();
create trigger trg_audit_lines    after insert or update or delete on public.purchase_invoice_lines
  for each row execute function public.audit_row();
create trigger trg_audit_payments after insert or update or delete on public.party_payments
  for each row execute function public.audit_row();
create trigger trg_audit_parties  after insert or update or delete on public.parties
  for each row execute function public.audit_row();


-- =============================================================================
-- 8. SEED DATA (masters from your Excel "Lists" sheet + sensible additions)
-- =============================================================================
insert into public.app_settings (id) values (1);

insert into public.payment_terms (days, description) values
  (30,'30 days'), (45,'45 days'), (60,'60 days'), (90,'90 days'), (120,'120 days');

insert into public.payment_modes (name, counts_as_payment, needs_reference, sort_order) values
  ('RTGS/NEFT',        true,  true,  1),
  ('Bank Transfer',    true,  true,  2),
  ('UPI',              true,  true,  3),
  ('Cheque',           true,  true,  4),
  ('Cash',             true,  false, 5),
  ('Other',            true,  false, 6),
  ('TDS',              false, false, 7),   -- reduces balance, not a payment to the party
  ('Discount / Kasar', false, false, 8),
  ('Opening Advance',  false, false, 9);   -- advance already with the party at go-live

insert into public.tax_rates (name, rate_percent, is_default) values
  ('GST 1.5%', 1.5, true),
  ('Nil',      0,   false);

insert into public.units (code, name) values ('ct','Carat'), ('gm','Gram');

-- =============================================================================
-- END
-- =============================================================================
