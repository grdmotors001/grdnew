-- Office Chat base schema for GRD
create extension if not exists pgcrypto;

create table if not exists chat_users (
  id text primary key,
  name text not null,
  avatar text,
  about text default '',
  created_at timestamptz default now()
);
alter table chat_users enable row level security;
create policy if not exists chat_users_sel on chat_users for select to authenticated using (true);

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  is_group boolean default false,
  title text,
  created_at timestamptz default now()
);
alter table conversations enable row level security;

create table if not exists participants (
  conversation_id uuid references conversations(id) on delete cascade,
  user_id text references chat_users(id) on delete cascade,
  last_read_at timestamptz,
  primary key(conversation_id,user_id)
);
alter table participants enable row level security;

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade,
  sender_id text references chat_users(id) on delete cascade,
  body text,
  file_url text,
  file_name text,
  file_type text,
  created_at timestamptz default now()
);
alter table messages enable row level security;

create or replace function start_dm(other text) returns uuid
language plpgsql security definer set search_path=public as $$
declare me text := auth.jwt()->>'sub'; cid uuid;
begin
  select p1.conversation_id into cid from participants p1 join participants p2 using(conversation_id)
  join conversations c on c.id=p1.conversation_id
  where p1.user_id=me and p2.user_id=other and c.is_group=false limit 1;
  if cid is not null then return cid; end if;
  insert into conversations(is_group) values(false) returning id into cid;
  insert into participants(conversation_id,user_id) values(cid,me),(cid,other);
  return cid;
end $$;

create policy if not exists conv_sel on conversations for select to authenticated using (
 exists(select 1 from participants p where p.conversation_id=conversations.id and p.user_id=auth.jwt()->>'sub')
);
create policy if not exists part_sel on participants for select to authenticated using (user_id=auth.jwt()->>'sub' or exists(select 1 from participants p where p.conversation_id=participants.conversation_id and p.user_id=auth.jwt()->>'sub'));
create policy if not exists msg_sel on messages for select to authenticated using (exists(select 1 from participants p where p.conversation_id=messages.conversation_id and p.user_id=auth.jwt()->>'sub'));
create policy if not exists msg_ins on messages for insert to authenticated with check (sender_id=auth.jwt()->>'sub' and exists(select 1 from participants p where p.conversation_id=messages.conversation_id and p.user_id=auth.jwt()->>'sub'));

alter publication supabase_realtime add table messages;
