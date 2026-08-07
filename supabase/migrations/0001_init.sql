-- Mexicano — Supabase schema (raw source-of-truth only).
--
-- Design rule: store ONLY raw data. Everything derivable (ELO ratings, player
-- stats, monthly overviews, per-player elo_history, tournaments index) is
-- computed at runtime by the client (js/services/elo.js, statistics.js,
-- ranking.js, attendance.js). Do NOT add derived columns here.
--
-- Auth model: "keep simple" — anon key with permissive write policies. Admin
-- gating stays client-side (administrators list). Tighten later by swapping the
-- permissive policies below for authenticated/role-based ones.

-- ─────────────────────────────────────────────────────────────────────────────
-- players — registry only (name + external id). No ELO/stats stored.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.players (
  id             bigint generated always as identity primary key,
  name           text not null unique,
  match_padel_id text,
  created_at     timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- matches — CORE source of truth. One row per played match (camelCase-friendly
-- snake_case columns). A "tournament" is the set of matches sharing match_date.
-- Player-ELO snapshot columns are OPTIONAL historical values captured at play
-- time in the old backups; kept nullable so we can round-trip archives, but the
-- app does not depend on them (ELO is recomputed at runtime).
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.matches (
  id                 bigint generated always as identity primary key,
  match_date         date not null,
  round_number       int  not null,
  score_team1        int  not null default 0,
  score_team2        int  not null default 0,
  team1_player1_name text not null,
  team1_player2_name text not null,
  team2_player1_name text not null,
  team2_player2_name text not null,
  team1_player1_elo  double precision,
  team1_player2_elo  double precision,
  team2_player1_elo  double precision,
  team2_player2_elo  double precision,
  created_at         timestamptz not null default now(),
  unique (match_date, round_number, team1_player1_name, team1_player2_name,
          team2_player1_name, team2_player2_name)
);

create index if not exists matches_match_date_idx on public.matches (match_date);

-- ─────────────────────────────────────────────────────────────────────────────
-- active_tournament — the single in-progress tournament (full JS object as jsonb).
-- Embeds rounds/players/config exactly like the old date-file `tournament` blob,
-- so any device can restore in-progress state. Enforced single row via id=true.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.active_tournament (
  id         boolean primary key default true,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  constraint active_tournament_singleton check (id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- doodle — availability per month + its changelog. One row per YYYY-MM.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.doodle (
  year_month text primary key check (year_month ~ '^\d{4}-\d{2}$'),
  entries    jsonb not null default '[]'::jsonb,
  changelog  jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- attendance_manual — manual (no-tournament) attendance entries. One row per date.
-- Shape mirrors data/attendance_manual.json entries: { date, players[], note }.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.attendance_manual (
  entry_date date primary key,
  players    jsonb not null default '[]'::jsonb,
  note       text  not null default '',
  updated_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- changelog — global app changelog (kept small; app trims to latest 20).
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.changelog (
  id         bigint generated always as identity primary key,
  entry      jsonb not null,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- administrators — admin name list (client-side gating). Kept as rows.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.administrators (
  name text primary key
);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — permissive (anon read + write). Swap for stricter policies to harden.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'players','matches','active_tournament','doodle',
    'attendance_manual','changelog','administrators'
  ]
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %I on public.%I;', t || '_anon_all', t);
    execute format(
      'create policy %I on public.%I for all to anon, authenticated using (true) with check (true);',
      t || '_anon_all', t
    );
  end loop;
end $$;
