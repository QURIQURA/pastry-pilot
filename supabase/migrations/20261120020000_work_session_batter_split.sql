-- An optional physical allocation on the existing selection. Recipe quantities and source orders
-- remain on the same records. Existing rows use the equal split until an allocation is saved.
alter table public.work_session_formula_versions
  add column if not exists batter_split_g integer[]
  check (
    batter_split_g is null or (
      cardinality(batter_split_g) between 1 and 100
      and array_ndims(batter_split_g) = 1
      and array_position(batter_split_g, null) is null
      and 0 < all(batter_split_g)
    )
  );
