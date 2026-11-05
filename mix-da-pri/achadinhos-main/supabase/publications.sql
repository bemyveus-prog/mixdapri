-- Central de Publicações — rode no SQL Editor do Supabase (uma vez só).
-- Só ADICIONA coisas: não altera nem apaga nenhuma oferta existente.

-- Galeria de fotos extras por oferta (o gerador de carrossel usa)
alter table public.offers add column if not exists image_urls text[] not null default '{}';

-- Fila e histórico de carrosséis (rascunhos e agendamentos)
create table if not exists public.publications (
  id           bigint generated always as identity primary key,
  title        text not null,
  caption      text,
  hashtags     text,
  platforms    text[] not null default '{}',
  status       text not null default 'draft' check (status in ('draft','scheduled','published','error')),
  scheduled_at timestamptz,
  products     jsonb not null default '[]',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists publications_created_idx on public.publications (created_at desc);
create index if not exists publications_queue_idx on public.publications (status, scheduled_at);

-- Mesmo esquema da tabela offers: só o servidor (service_role) acessa
alter table public.publications enable row level security;
