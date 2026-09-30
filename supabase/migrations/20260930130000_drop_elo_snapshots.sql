-- ELO and ELO change are calculated at runtime from matches; drop the stored projection.
begin;

drop function if exists public.replace_elo_projection(jsonb);
drop table if exists public.elo_snapshots;

commit;
