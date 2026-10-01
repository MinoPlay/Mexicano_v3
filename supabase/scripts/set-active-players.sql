-- Run in the Supabase SQL editor after replacing every placeholder below.
-- Every listed player becomes active; every other player becomes inactive.
-- Historical matches are preserved because this changes only players.active.

begin;

create temporary table active_player_allowlist (
  name text primary key
) on commit drop;

insert into active_player_allowlist (name) values
  ('Caroline'),
  ('Casper'),
  ('Chris'),
  ('Christian Linkhusen'),
  ('Christian Wennergren'),
  ('Dennis'),
  ('Georgios'),
  ('Gusztav Locsei'),
  ('Jeremy'),
  ('John Paul'),
  ('Jonas'),
  ('Kasper Arp'),
  ('Kikke'),
  ('Mads Prebensen'),
  ('Mark Brooks'),
  ('Mattijs'),
  ('Mino'),
  ('Morten Sunesen'),
  ('Morten Westergaard'),
  ('Nikolaj'),
  ('Peter'),
  ('Peter Dehn'),
  ('Ulrik');

do $$
declare
  missing_names text;
begin
  if exists (
    select 1
    from active_player_allowlist
    where name like 'REPLACE WITH ACTIVE PLAYER%'
       or btrim(name) = ''
  ) then
    raise exception 'Replace all active-player placeholders before running this script';
  end if;

  select string_agg(a.name, ', ' order by a.name)
    into missing_names
  from active_player_allowlist a
  left join public.players p on lower(p.name) = lower(btrim(a.name))
  where p.id is null;

  if missing_names is not null then
    raise exception 'Active-player names not found in public.players: %', missing_names;
  end if;
end
$$;

update public.players as p
set active = exists (
      select 1
      from active_player_allowlist a
      where lower(btrim(a.name)) = lower(p.name)
    ),
    updated_at = now()
where p.active is distinct from exists (
  select 1
  from active_player_allowlist a
  where lower(btrim(a.name)) = lower(p.name)
);

select name, active
from public.players
order by active desc, name;

commit;
