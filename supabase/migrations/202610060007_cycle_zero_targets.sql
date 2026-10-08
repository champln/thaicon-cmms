-- Generated cycles may have target zero when the annual target is smaller than
-- the number of cycles. Preserve annual_target > 0 and all historical values.
alter table public.plan_cycles drop constraint plan_cycles_target_check;
alter table public.plan_cycles add constraint plan_cycles_target_check check (target >= 0);
