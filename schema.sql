-- Rode este script no SQL Editor do seu projeto Supabase (Project > SQL Editor > New query)

create table if not exists players (
  id uuid primary key default gen_random_uuid(),
  environment text not null check (environment in ('quarta','sexta')),
  name text not null,
  skill int not null check (skill between 1 and 5),
  created_at timestamptz default now()
);

create table if not exists draws (
  environment text primary key check (environment in ('quarta','sexta')),
  num_teams int not null default 2,
  teams jsonb,
  updated_at timestamptz default now()
);

-- Base compartilhada de jogadores já cadastrados alguma vez (em Quarta ou Sexta),
-- para poder reaproveitar nome + nota com um clique, sem digitar de novo.
create table if not exists known_players (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  skill int not null check (skill between 1 and 5),
  updated_at timestamptz default now()
);

alter table players enable row level security;
alter table draws enable row level security;
alter table known_players enable row level security;

-- Acesso liberado para o grupo pequeno e de confiança da diretoria.
-- A proteção de acesso é feita pela senha compartilhada na própria página (nível de UI, não de banco).
create policy "public read players" on players for select using (true);
create policy "public insert players" on players for insert with check (true);
create policy "public update players" on players for update using (true);
create policy "public delete players" on players for delete using (true);

create policy "public read draws" on draws for select using (true);
create policy "public insert draws" on draws for insert with check (true);
create policy "public update draws" on draws for update using (true);

create policy "public read known_players" on known_players for select using (true);
create policy "public insert known_players" on known_players for insert with check (true);
create policy "public update known_players" on known_players for update using (true);
create policy "public delete known_players" on known_players for delete using (true);

-- Tempo real (necessário além das policies acima; sem isso os 3 diretores não veem
-- as mudanças uns dos outros ao vivo).
alter publication supabase_realtime add table players;
alter publication supabase_realtime add table draws;
alter publication supabase_realtime add table known_players;
