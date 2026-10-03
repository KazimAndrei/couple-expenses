-- Income entries had only SELECT/INSERT policies, so DELETE from the app
-- matched 0 rows without an error: the toast said "deleted", the entry stayed.
-- Same rule as expenses: any member of the couple can delete.
DROP POLICY IF EXISTS "Delete income entries" ON public.couple_income_entries;
CREATE POLICY "Delete income entries" ON public.couple_income_entries
  FOR DELETE USING (couple_id = public.my_couple_id());
