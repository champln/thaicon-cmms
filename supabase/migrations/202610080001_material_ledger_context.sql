-- Read-only ledger guard. Does not enable gates or mutate operational rows.
create function public.material_ledger_context(p_site_id text,p_orders jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor_role text; item jsonb; actual_version bigint; seen text[]:=array[]::text[];
begin
 actor_role:=private.current_user_role();
 if actor_role is null or not private.can_access_jobsite(p_site_id)
   or not exists(select 1 from public.jobsites where id=p_site_id and is_active)
   or not private.work_order_commands_enabled() then
   raise exception 'Material ledger scope denied' using errcode='42501';
 end if;
 if p_orders is null or jsonb_typeof(p_orders)<>'array' then
   raise exception 'Invalid ledger parents' using errcode='22023';
 end if;
 if octet_length(p_orders::text)>8388608 then
   raise exception 'Ledger selection too large' using errcode='54000';
 end if;
 for item in select value from jsonb_array_elements(p_orders) loop
   if jsonb_typeof(item)<>'object' or jsonb_typeof(item->'id') is distinct from 'string'
     or coalesce(length(btrim(item->>'id')),0)=0 or (item->>'id')=any(seen)
     or jsonb_typeof(item->'version') is distinct from 'number' then
     raise exception 'Invalid ledger parent' using errcode='22023';
   end if;
   if (item->>'version')::numeric<1 or (item->>'version')::numeric>9007199254740991
     or (item->>'version')::numeric<>trunc((item->>'version')::numeric) then
     raise exception 'Invalid ledger version' using errcode='22023';
   end if;
   seen:=array_append(seen,item->>'id');
   select w.version into actual_version from public.work_orders w
     where w.id=item->>'id' and w.jobsite_id=p_site_id;
   if not found then raise exception 'Ledger parent unavailable' using errcode='42501';end if;
   if actual_version<>(item->>'version')::bigint then
     raise exception 'Ledger changed; reload' using errcode='40001';
   end if;
 end loop;
 return jsonb_build_object('protocol',1,'site_id',p_site_id,'actor_id',auth.uid(),
   'actor_role',actor_role,'enabled',true,'parent_count',jsonb_array_length(p_orders));
end;$$;
revoke all on function public.material_ledger_context(text,jsonb) from public,anon;
grant execute on function public.material_ledger_context(text,jsonb) to authenticated;
