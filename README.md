# 🏐 Sorteio de Times — Vôlei de Areia

Site estático (sem necessidade de instalar nada) para a diretoria sortear times equilibrados nos treinos de **Quarta** e **Sexta**, cada um com sua própria lista de jogadores.

## Como funciona

- Acesso protegido por uma **senha simples compartilhada** entre os 3 diretores.
- Cada dia (Quarta/Sexta) tem sua própria lista de jogadores e seu próprio sorteio — totalmente independentes.
- Cadastre jogadores com **nome** e **nota de habilidade (1 a 5)**.
- Escolha quantos times quer sortear.
- O sorteio distribui os jogadores tentando deixar a **soma de habilidade de cada time o mais parecida possível** (não é aleatório puro — é balanceado).
- Os dados ficam salvos no Supabase, então os 3 diretores veem a mesma informação em tempo real, de qualquer dispositivo.

## Passo 1 — Criar o banco de dados (Supabase, gratuito)

1. Acesse https://supabase.com e crie uma conta gratuita.
2. Clique em **New Project**. Dê um nome (ex: `volei-sorteio`) e uma senha de banco (guarde, mas não precisará dela aqui).
3. Aguarde o projeto ser criado (leva ~1 minuto).
4. No menu lateral, vá em **SQL Editor** → **New query**.
5. Abra o arquivo [`schema.sql`](./schema.sql) deste projeto, copie todo o conteúdo, cole no editor do Supabase e clique em **Run**.
   - Isso cria as tabelas `players` e `draws` já com as permissões corretas.
6. Vá em **Project Settings** (ícone de engrenagem) → **API**.
7. Copie os valores de:
   - **Project URL**
   - **anon public** key (a chave pública, não a `service_role`)

## Passo 2 — Configurar o site

1. Abra o arquivo [`config.js`](./config.js) neste projeto.
2. Cole a **Project URL** em `SUPABASE_URL`.
3. Cole a **anon public key** em `SUPABASE_ANON_KEY`.
4. Troque `SHARED_PASSWORD` pela senha que a diretoria vai usar para acessar o site.

```js
const SUPABASE_URL = "https://xxxxx.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOi...";
const SHARED_PASSWORD = "sua-senha-aqui";
```

## Passo 3 — Testar localmente (opcional)

Como é um site estático, você pode simplesmente abrir `index.html` no navegador. Se preferir rodar um servidor local:

```bash
cd volei-sorteio
python3 -m http.server 8080
```

Depois acesse `http://localhost:8080`.

## Passo 4 — Publicar no Vercel

Como o site não precisa de build (é HTML/CSS/JS puro), a forma mais simples é:

1. Acesse https://vercel.com e crie uma conta gratuita (pode usar login do GitHub).
2. No dashboard, clique em **Add New... → Project**.
3. Escolha a opção de importar via **arrastar e soltar a pasta** (drag and drop) ou conecte um repositório Git com esses arquivos.
   - Se for arrastar a pasta: existe uma área de upload direto no dashboard da Vercel para projetos estáticos.
   - Se preferir Git: crie um repositório (ex: no GitHub), suba estes arquivos (`git init`, `git add .`, `git commit`, `git push`) e depois importe esse repositório na Vercel.
4. Não é necessário configurar "Build Command" — deixe em branco ou "None", já que são arquivos estáticos.
5. Clique em **Deploy**. Em ~30 segundos você recebe uma URL pública (ex: `https://volei-sorteio.vercel.app`).
6. Compartilhe essa URL + a senha com os outros 2 diretores.

## Observação sobre segurança

A senha compartilhada é uma proteção simples no nível da página (evita que qualquer pessoa que ache o link mexa nos dados por engano), não é uma autenticação forte. Para um grupo pequeno e de confiança como a diretoria, isso é suficiente. Se no futuro quiser mais segurança (login individual por diretor), dá para evoluir usando Supabase Auth.

## Estrutura de arquivos

- `index.html` — estrutura da página
- `style.css` — visual (tema praia/vôlei de areia)
- `app.js` — lógica (CRUD de jogadores, algoritmo de sorteio balanceado, tempo real)
- `config.js` — suas credenciais do Supabase e a senha (não compartilhe publicamente este arquivo com as chaves reais se o repositório for público — para esse caso de uso, um repositório privado é recomendado)
- `schema.sql` — script para criar as tabelas no Supabase
