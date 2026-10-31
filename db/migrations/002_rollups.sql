-- Rebuilds pre-added totals (org_rollup_daily) for one dealer and a date range.
-- Called after each import (one date) and by the sample-data generator (all dates).
--
-- For every org unit (store, district, area, region, dealer) and date:
--   sum KPIs           -> added up across all stores under the unit
--   weighted_avg KPIs  -> sum(value * weight) / sum(weight)
--   ratio KPIs         -> not stored; screens divide the summed numerator/denominator
create or replace function refresh_rollups(p_dealer int, p_from date, p_to date) returns int
language plpgsql as $$
declare n int;
begin
  delete from org_rollup_daily
   where dealer_id = p_dealer and biz_date between p_from and p_to;

  with anc as (
    -- every store paired with itself and each of its ancestors
    select st.id as store_id, a.id as unit_id
      from org_units st
      join org_units a on a.dealer_id = p_dealer and a.path @> st.path
     where st.dealer_id = p_dealer and st.level_key = 'store'
  ),
  kv as (
    select s.biz_date, s.store_id, e.key, e.value::numeric as v, k.agg,
           case when k.agg = 'weighted_avg'
                then coalesce((s.m ->> k.weight_kpi)::numeric, 0) end as w
      from store_daily_mtd s
      cross join lateral jsonb_each_text(s.m) e
      join kpi_catalog k on k.code = e.key
     where s.dealer_id = p_dealer and s.biz_date between p_from and p_to
       and e.value is not null
  ),
  agg as (
    select kv.biz_date, anc.unit_id, kv.key,
           case when min(kv.agg) = 'weighted_avg'
                then sum(kv.v * kv.w) / nullif(sum(kv.w), 0)
                else sum(kv.v) end as val
      from kv join anc using (store_id)
     group by kv.biz_date, anc.unit_id, kv.key
  ),
  counts as (
    select s.biz_date, anc.unit_id, count(*)::int as store_count
      from store_daily_mtd s join anc using (store_id)
     where s.dealer_id = p_dealer and s.biz_date between p_from and p_to
     group by s.biz_date, anc.unit_id
  )
  insert into org_rollup_daily (dealer_id, biz_date, org_unit_id, store_count, m)
  select p_dealer, agg.biz_date, agg.unit_id, c.store_count,
         jsonb_object_agg(agg.key, trim_scale(round(agg.val, 4))) filter (where agg.val is not null)
    from agg
    join counts c on c.biz_date = agg.biz_date and c.unit_id = agg.unit_id
   group by agg.biz_date, agg.unit_id, c.store_count;

  get diagnostics n = row_count;
  return n;
end $$;

grant execute on function refresh_rollups(int, date, date) to dd_app;
