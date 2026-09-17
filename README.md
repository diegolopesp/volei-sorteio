# 🏐 Sorteio de Times — Vôlei de Areia

Site estático (sem necessidade de instalar nada) para a diretoria sortear times equilibrados nos treinos de **Quarta** e **Sexta**, cada um com sua própria lista de jogadores.

## Como funciona

- Acesso protegido por uma **senha simples compartilhada** entre os 3 diretores.
- Cada dia (Quarta/Sexta) tem sua própria lista de jogadores e seu próprio sorteio — totalmente independentes.
- Cadastre jogadores com **nome** e uma nota de **0 a 5 estrelas em 4 habilidades**: Saque, Levantamento, Recepção e Movimentação.
- Essas notas (e a média delas) só aparecem para quem entra com a **senha gerencial** separada (botão "🔒 Gerencial" no topo). Sem essa senha, qualquer diretor/jogador vê só o nome e pode marcar quem está **presente** no dia, mas não vê nem edita as notas.
- Escolha quantos times quer sortear.
- O sorteio usa só quem está marcado como **presente** e distribui os jogadores tentando deixar a **média das 4 habilidades de cada time o mais parecida possível** (balanceado, mas com uma embaralhada antes — então clicar de novo em "Sortear" pode dar uma combinação diferente entre jogadores de nível parecido).
- Os dados ficam salvos no Supabase, então os 3 diretores veem a mesma informação em tempo real, de qualquer dispositivo.

## Passo 1 — Criar o banco de dados (Supabase, gratuito)

1. Acesse https://supabase.com e crie uma conta gratuita.
2. Clique em **New Project**. Dê um nome (ex: `volei-sorteio`) e uma senha de banco (guarde, mas não precisará dela aqui).
3. Aguarde o projeto ser criado (leva ~1 minuto).
4. No menu lateral, vá em **SQL Editor** → **New query**.
5. Abra o arquivo [`schema.sql`](./schema.sql) deste projeto, copie todo o conteúdo, cole no editor do Supabase e clique em **Run**.
   - Isso cria as tabelas `players`, `draws` e `known_players` já com as permissões corretas — e se o projeto já existia com o schema antigo (nota única), o próprio script migra os dados para as 4 habilidades novas.
6. Vá em **Project Settings** (ícone de engrenagem) → **API**.
7. Copie os valores de:
   - **Project URL**
   - **anon public** key (a chave pública, não a `service_role`)

## Passo 2 — Configurar o site

1. Abra o arquivo [`config.js`](./config.js) neste projeto.
2. Cole a **Project URL** em `SUPABASE_URL`.
3. Cole a **anon public key** em `SUPABASE_ANON_KEY`.
4. Troque `SHARED_PASSWORD` pela senha que a diretoria vai usar para acessar o site.
5. Troque `ADMIN_PASSWORD` por uma senha à parte — só quem souber essa senha vê e edita as notas de habilidade.

```js
const SUPABASE_URL = "https://xxxxx.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOi...";
const SHARED_PASSWORD = "sua-senha-de-acesso";
const ADMIN_PASSWORD = "sua-senha-gerencial";
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

As senhas (de acesso e gerencial) são uma proteção simples no nível da página — evitam que qualquer pessoa que ache o link mexa nos dados ou veja as notas por engano — mas **não são autenticação forte**. Como é um site estático sem servidor próprio, o código roda inteiro no navegador de quem acessa: alguém com conhecimento técnico e acesso ao link publicado (abrindo o "Inspecionar" do navegador) consegue ver as senhas e os dados que trafegam, mesmo os das notas gerenciais. Para o uso real — evitar que jogadores comuns vejam ou editem as notas sem querer — isso é suficiente; não trate como confidencial algo que, se exposto, causaria problema sério.

Dito isso, dois cuidados valem a pena:
- **Deixe o repositório do GitHub como privado.** Hoje ele está público, e o `config.js` (com a URL do Supabase, a chave anon e as duas senhas) está commitado nele — qualquer pessoa pode abrir o repositório e ler os valores diretamente no código-fonte, sem nem precisar acessar o site publicado.
- Se quiser um nível de proteção mais forte no futuro (login individual por diretor, dados realmente inacessíveis sem autenticação do servidor), o caminho é evoluir para Supabase Auth com Row Level Security por usuário — bem mais trabalho, mas é o próximo degrau de segurança de verdade.

## Estrutura de arquivos

- `index.html` — estrutura da página
- `style.css` — visual (tema praia/vôlei de areia)
- `app.js` — lógica (CRUD de jogadores, algoritmo de sorteio balanceado, tempo real)
- `config.js` — suas credenciais do Supabase e a senha (não compartilhe publicamente este arquivo com as chaves reais se o repositório for público — para esse caso de uso, um repositório privado é recomendado)
- `schema.sql` — script para criar as tabelas no Supabase
