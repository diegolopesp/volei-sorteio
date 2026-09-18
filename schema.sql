-- Rode este script no SQL Editor do seu projeto Supabase (Project > SQL Editor > New query)
-- Este script é seguro tanto para um projeto Supabase novo quanto para um que já tinha o
-- schema antigo (coluna única "skill") — a migração no fim detecta o que precisa mudar.

create table if not exists players (
  id uuid primary key default gen_random_uuid(),
  environment text not null check (environment in ('quarta','sexta')),
  name text not null,
  skill_saque int not null default 0 check (skill_saque between 0 and 5),
  skill_levantamento int not null default 0 check (skill_levantamento between 0 and 5),
  skill_recepcao int not null default 0 check (skill_recepcao between 0 and 5),
  skill_movimentacao int not null default 0 check (skill_movimentacao between 0 and 5),
  skill_ataque int not null default 0 check (skill_ataque between 0 and 5),
  present boolean not null default true,
  created_at timestamptz default now()
);

create table if not exists draws (
  environment text primary key check (environment in ('quarta','sexta')),
  num_teams int not null default 2,
  teams jsonb,
  updated_at timestamptz default now()
);

-- Base compartilhada de jogadores já cadastrados alguma vez (em Quarta ou Sexta),
-- para poder reaproveitar nome + notas com um clique, sem digitar de novo.
create table if not exists known_players (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  skill_saque int not null default 0 check (skill_saque between 0 and 5),
  skill_levantamento int not null default 0 check (skill_levantamento between 0 and 5),
  skill_recepcao int not null default 0 check (skill_recepcao between 0 and 5),
  skill_movimentacao int not null default 0 check (skill_movimentacao between 0 and 5),
  skill_ataque int not null default 0 check (skill_ataque between 0 and 5),
  updated_at timestamptz default now()
);

alter table players enable row level security;
alter table draws enable row level security;
alter table known_players enable row level security;

-- Acesso liberado para o grupo pequeno e de confiança da diretoria.
-- A proteção de acesso é feita pelas senhas compartilhadas na própria página (nível de UI,
-- não de banco) — veja a nota de segurança no README sobre os limites disso.
drop policy if exists "public read players" on players;
drop policy if exists "public insert players" on players;
drop policy if exists "public update players" on players;
drop policy if exists "public delete players" on players;
create policy "public read players" on players for select using (true);
create policy "public insert players" on players for insert with check (true);
create policy "public update players" on players for update using (true);
create policy "public delete players" on players for delete using (true);

drop policy if exists "public read draws" on draws;
drop policy if exists "public insert draws" on draws;
drop policy if exists "public update draws" on draws;
create policy "public read draws" on draws for select using (true);
create policy "public insert draws" on draws for insert with check (true);
create policy "public update draws" on draws for update using (true);

drop policy if exists "public read known_players" on known_players;
drop policy if exists "public insert known_players" on known_players;
drop policy if exists "public update known_players" on known_players;
drop policy if exists "public delete known_players" on known_players;
create policy "public read known_players" on known_players for select using (true);
create policy "public insert known_players" on known_players for insert with check (true);
create policy "public update known_players" on known_players for update using (true);
create policy "public delete known_players" on known_players for delete using (true);

-- Tempo real (necessário além das policies acima; sem isso os 3 diretores não veem
-- as mudanças uns dos outros ao vivo).
alter publication supabase_realtime add table players;
alter publication supabase_realtime add table draws;
alter publication supabase_realtime add table known_players;

-- ================= MIGRAÇÃO (projeto já existia com o schema antigo, nota única) =================
-- Bloco idempotente: só mexe em algo se a coluna antiga "skill" ainda existir.
do $$
begin
  if exists (select 1 from information_schema.columns where table_name = 'players' and column_name = 'skill') then
    alter table players add column if not exists skill_saque int;
    alter table players add column if not exists skill_levantamento int;
    alter table players add column if not exists skill_recepcao int;
    alter table players add column if not exists skill_movimentacao int;
    update players set
      skill_saque = coalesce(skill_saque, skill),
      skill_levantamento = coalesce(skill_levantamento, skill),
      skill_recepcao = coalesce(skill_recepcao, skill),
      skill_movimentacao = coalesce(skill_movimentacao, skill);
    alter table players alter column skill_saque set default 0;
    alter table players alter column skill_levantamento set default 0;
    alter table players alter column skill_recepcao set default 0;
    alter table players alter column skill_movimentacao set default 0;
    alter table players alter column skill_saque set not null;
    alter table players alter column skill_levantamento set not null;
    alter table players alter column skill_recepcao set not null;
    alter table players alter column skill_movimentacao set not null;
    alter table players add constraint players_skill_saque_check check (skill_saque between 0 and 5);
    alter table players add constraint players_skill_levantamento_check check (skill_levantamento between 0 and 5);
    alter table players add constraint players_skill_recepcao_check check (skill_recepcao between 0 and 5);
    alter table players add constraint players_skill_movimentacao_check check (skill_movimentacao between 0 and 5);
    alter table players drop column skill;
  end if;

  if not exists (select 1 from information_schema.columns where table_name = 'players' and column_name = 'present') then
    alter table players add column present boolean not null default true;
  end if;

if not exists (select 1 from information_schema.columns where table_name = 'players' and column_name = 'skill_ataque') then
  alter table players add column skill_ataque int not null default 0 check (skill_ataque between 0 and 5);
end if;
end $$;

do $$
begin
  if exists (select 1 from information_schema.columns where table_name = 'known_players' and column_name = 'skill') then
    alter table known_players add column if not exists skill_saque int;
    alter table known_players add column if not exists skill_levantamento int;
    alter table known_players add column if not exists skill_recepcao int;
    alter table known_players add column if not exists skill_movimentacao int;
    update known_players set
      skill_saque = coalesce(skill_saque, skill),
      skill_levantamento = coalesce(skill_levantamento, skill),
      skill_recepcao = coalesce(skill_recepcao, skill),
      skill_movimentacao = coalesce(skill_movimentacao, skill);
    alter table known_players alter column skill_saque set default 0;
    alter table known_players alter column skill_levantamento set default 0;
    alter table known_players alter column skill_recepcao set default 0;
    alter table known_players alter column skill_movimentacao set default 0;
    alter table known_players alter column skill_saque set not null;
    alter table known_players alter column skill_levantamento set not null;
    alter table known_players alter column skill_recepcao set not null;
    alter table known_players alter column skill_movimentacao set not null;
    alter table known_players add constraint known_players_skill_saque_check check (skill_saque between 0 and 5);
    alter table known_players add constraint known_players_skill_levantamento_check check (skill_levantamento between 0 and 5);
    alter table known_players add constraint known_players_skill_recepcao_check check (skill_recepcao between 0 and 5);
    alter table known_players add constraint known_players_skill_movimentacao_check check (skill_movimentacao between 0 and 5);
    alter table known_players drop column skill;
  end if;

if not exists (select 1 from information_schema.columns where table_name = 'known_players' and column_name = 'skill_ataque') then
  alter table known_players add column skill_ataque int not null default 0 check (skill_ataque between 0 and 5);
end if;
end $$;
