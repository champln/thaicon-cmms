create table public.asset_locations (
 id uuid primary key default gen_random_uuid(),
 jobsite_id text not null references public.jobsites(id) on delete restrict,
 building text not null, floor text not null default '', room text not null default '',
 created_at timestamptz not null default now(),
 constraint asset_locations_path_valid check (
 length(building) between 1 and 200 and building=trim(building)
 and length(floor)<=200 and floor=trim(floor)
 and length(room)<=200 and room=trim(room) and (room='' or floor<>'')),
 unique(jobsite_id,building,floor,room), unique(jobsite_id,id)
);
alter table public.asset_locations enable row level security;
revoke all on public.asset_locations from anon, authenticated;
grant select, insert on public.asset_locations to authenticated;
create policy "Users can read authorized location paths" on public.asset_locations for select to authenticated using (private.can_access_jobsite(jobsite_id));
create policy "Admins can create location paths" on public.asset_locations for insert to authenticated with check (private.current_user_role()='admin');
alter table public.assets add column location_id uuid;
alter table public.assets add constraint assets_location_same_site_fk foreign key(jobsite_id,location_id) references public.asset_locations(jobsite_id,id) on delete restrict;
create index assets_location_idx on public.assets(jobsite_id,location_id);
create function private.sync_asset_location() returns trigger language plpgsql set search_path='' as $$
declare loc public.asset_locations%rowtype;
begin
 if new.location_id is not null then
 select * into loc from public.asset_locations where id=new.location_id and jobsite_id=new.jobsite_id;
 if not found then raise exception 'Asset location must belong to the same jobsite'; end if;
 new.building:=loc.building; new.floor:=loc.floor; new.room:=loc.room;
 end if;
 return new;
end;
$$;
revoke all on function private.sync_asset_location() from public;
create trigger assets_sync_location before insert or update on public.assets for each row execute function private.sync_asset_location();
