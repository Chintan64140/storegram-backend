alter table public.files
add column if not exists folder_id uuid null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'files_folder_id_fkey'
  ) then
    alter table public.files
    add constraint files_folder_id_fkey
    foreign key (folder_id)
    references public.folders(id)
    on delete set null;
  end if;
end $$;

create index if not exists idx_files_folder_id
on public.files(folder_id);
