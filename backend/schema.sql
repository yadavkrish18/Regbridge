-- RegBridge Supabase schema
-- Run once in the Supabase SQL editor for your project.

create table if not exists circulars (
  id text primary key,
  title text not null,
  ref text default '',
  intermediary text not null,
  created_at timestamptz not null default now(),
  raw_text text not null
);

create table if not exists obligations (
  id text primary key,
  circular_id text not null references circulars(id) on delete cascade,
  description text not null,
  category text not null default 'Other',
  deadline text not null default 'Not specified',
  intermediary_type text not null,
  source_excerpt text default '',
  status text not null default 'Missing',
  evidence_note text default '',
  evidence_file_name text default '',
  updated_at timestamptz not null default now()
);

create index if not exists obligations_circular_id_idx on obligations(circular_id);
create index if not exists obligations_status_idx on obligations(status);

create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  ts timestamptz not null default now(),
  event text not null,
  ref text default '',
  detail text default ''
);

create index if not exists audit_log_ts_idx on audit_log(ts desc);
