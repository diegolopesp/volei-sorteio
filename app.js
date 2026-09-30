// ============================================
// Sorteio de Times — Vôlei de Areia
// ============================================

const TEAM_COLORS = [
  { name: "Amarelo", hex: "#f0c419" },
  { name: "Verde", hex: "#12907a" },
  { name: "Azul", hex: "#2e78b7" },
  { name: "Vermelho", hex: "#d9534f" },
  { name: "Laranja", hex: "#e8792f" },
  { name: "Roxo", hex: "#8e5bc9" },
  { name: "Rosa", hex: "#d95caa" },
  { name: "Cinza", hex: "#607d8b" },
];

const ENV_LABELS = { quarta: "Quarta", sexta: "Sexta" };

// As 5 habilidades avaliadas, cada uma de 0 a 5 estrelas.
const SKILLS = [
  { key: "skill_saque", label: "Saque" },
  { key: "skill_levantamento", label: "Levant." },
  { key: "skill_recepcao", label: "Recep." },
  { key: "skill_movimentacao", label: "Moviment." },
  { key: "skill_ataque", label: "Ataque" },
];

let supabaseClient = null;
let currentEnv = "quarta";
let players = []; // players for current env
let currentDraw = null; // { num_teams, teams }
let playersChannel = null;
let drawsChannel = null;
let extraRows = 0; // blank rows added beyond the minimum, via "+ Adicionar linha"
const MIN_PLAYER_ROWS = 25;
let knownPlayers = []; // shared directory of every player ever added, across both days
let knownPlayersChannel = null;
let isAdmin = false; // unlocked with ADMIN_PASSWORD — controls visibility of skill notes

// Quantos sorteios recentes (por ambiente) entram na conta de "quem já jogou
// com quem", usada para variar as duplas do próximo sorteio.
const HISTORY_LOOKBACK = 6;

let calendarMonth = new Date(); // mês (dia 1) atualmente exibido no calendário
let calendarHistory = {}; // { "YYYY-MM-DD": { quarta: row|undefined, sexta: row|undefined } }
let selectedCalendarDate = null;
let drawHistoryChannel = null;

const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

// Média das 4 habilidades — usada para balancear os times. Só é exibida na UI
// quando isAdmin é true (o objeto do jogador continua tendo os valores porque
// o dado chega do Supabase para qualquer usuário logado; o que fica restrito
// é a exibição na tela, no mesmo nível de proteção da senha de acesso geral —
// não é uma autenticação forte de servidor, ver README).
function overallSkill(p) {
  const sum = SKILLS.reduce((acc, s) => acc + (Number(p[s.key]) || 0), 0);
  return sum / SKILLS.length;
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- Gate ----------
function initGate() {
  const gate = document.getElementById("gate");
  const app = document.getElementById("app");
  const input = document.getElementById("password-input");
  const btn = document.getElementById("password-submit");
  const errorMsg = document.getElementById("password-error");

  if (sessionStorage.getItem("volei_authed") === "1") {
    gate.classList.add("hidden");
    app.classList.remove("hidden");
    startApp();
    return;
  }

  function tryLogin() {
    if (input.value === SHARED_PASSWORD) {
      sessionStorage.setItem("volei_authed", "1");
      gate.classList.add("hidden");
      app.classList.remove("hidden");
      startApp();
    } else {
      errorMsg.textContent = "Senha incorreta. Tente novamente.";
    }
  }

  btn.addEventListener("click", tryLogin);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") tryLogin();
  });
}

// ---------- App bootstrap ----------
function startApp() {
  // Wired up first (and independent of the Supabase connection below) so the
  // admin (gerencial) gate still works even if Supabase fails to load.
  document.getElementById("btn-admin-toggle").addEventListener("click", toggleAdminBar);
  document.getElementById("btn-admin-logout").addEventListener("click", adminLogout);
  document.getElementById("admin-password-submit").addEventListener("click", tryAdminLogin);
  document.getElementById("admin-password-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") tryAdminLogin();
  });
  if (sessionStorage.getItem("volei_admin") === "1") isAdmin = true;
  updateAdminUI();

  if (
    !SUPABASE_URL ||
    SUPABASE_URL.startsWith("COLE_AQUI") ||
    !SUPABASE_ANON_KEY ||
    SUPABASE_ANON_KEY.startsWith("COLE_AQUI")
  ) {
    document.getElementById("conn-label").textContent =
      "config.js não preenchido — veja o README";
    document.getElementById("conn-dot").classList.add("offline");
    const banner = document.createElement("div");
    banner.className = "config-warning";
    banner.textContent =
      "⚠️ Configuração pendente: abra config.js e preencha SUPABASE_URL e SUPABASE_ANON_KEY com os dados do seu projeto Supabase (veja o README).";
    document.querySelector(".main").prepend(banner);
    return;
  }

  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  setConnStatus("online");

  document.querySelectorAll(".day-tab").forEach((tab) => {
    tab.addEventListener("click", () => switchEnv(tab.dataset.env));
  });

  document.getElementById("btn-add-row").addEventListener("click", () => {
    extraRows++;
    renderPlayers();
  });
  document.getElementById("num-teams").addEventListener("change", onNumTeamsChange);
  document.getElementById("btn-shuffle").addEventListener("click", onShuffle);
  document.getElementById("btn-clear-draw").addEventListener("click", onClearDraw);

  document.getElementById("cal-prev").addEventListener("click", () => changeCalendarMonth(-1));
  document.getElementById("cal-next").addEventListener("click", () => changeCalendarMonth(1));

  loadKnownPlayers();
  subscribeKnownPlayersRealtime();
  loadCalendarMonth();
  subscribeDrawHistoryRealtime();

  switchEnv("quarta");
}

// ---------- Admin gate (senha gerencial — controla quem vê as notas) ----------
function toggleAdminBar() {
  document.getElementById("admin-bar").classList.toggle("hidden");
  document.getElementById("admin-password-input").focus();
}

function tryAdminLogin() {
  const input = document.getElementById("admin-password-input");
  const err = document.getElementById("admin-error");
  if (input.value === ADMIN_PASSWORD) {
    isAdmin = true;
    sessionStorage.setItem("volei_admin", "1");
    input.value = "";
    err.textContent = "";
    document.getElementById("admin-bar").classList.add("hidden");
    updateAdminUI();
    renderPlayers();
    renderKnownPlayers();
    renderTeams();
    if (selectedCalendarDate) renderCalendarDetail(selectedCalendarDate);
  } else {
    err.textContent = "Senha gerencial incorreta.";
  }
}

function adminLogout() {
  isAdmin = false;
  sessionStorage.removeItem("volei_admin");
  updateAdminUI();
  renderPlayers();
  renderKnownPlayers();
  renderTeams();
  if (selectedCalendarDate) renderCalendarDetail(selectedCalendarDate);
}

function updateAdminUI() {
  document.body.classList.toggle("is-admin", isAdmin);
  document.getElementById("btn-admin-toggle").classList.toggle("hidden", isAdmin);
  document.getElementById("admin-badge").classList.toggle("hidden", !isAdmin);
  document.getElementById("players-subtitle").textContent = isAdmin
    ? "Digite o nome, escolha as estrelas quando quiser e clique em Salvar para confirmar cada jogador. Linhas sem nome salvo são ignoradas no sorteio."
    : "Marque quem está presente hoje. As notas de habilidade só aparecem no modo gerencial.";
}

function setConnStatus(status) {
  const dot = document.getElementById("conn-dot");
  const label = document.getElementById("conn-label");
  dot.classList.remove("online", "offline");
  if (status === "online") {
    dot.classList.add("online");
    label.textContent = "conectado";
  } else {
    dot.classList.add("offline");
    label.textContent = "sem conexão";
  }
}

// ---------- Environment switching ----------
async function switchEnv(env) {
  currentEnv = env;
  extraRows = 0;
  document.querySelectorAll(".day-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.env === env);
  });
  document.getElementById("env-subtitle").textContent = `Monte os times de ${ENV_LABELS[env]} em segundos`;
  document.getElementById("env-label-players").textContent = ENV_LABELS[env];
  document.getElementById("env-label-teams").textContent = ENV_LABELS[env];

  teardownRealtime();
  await loadPlayers();
  await syncKnownPlayersIntoEnv();
  await loadDraw();
  subscribeRealtime();
}

// Garante que todo jogador da base compartilhada (known_players) já tenha uma
// linha na planilha do dia atual — assim ninguém precisa ser digitado de novo
// nem readicionado clicando no chip amarelo toda semana. O jogador some no
// "presente" (precisa ser confirmado marcando a caixinha) mas continua fixo
// na planilha como participante do mensal, elegível pro sorteio assim que a
// presença for marcada.
async function syncKnownPlayersIntoEnv() {
  if (!knownPlayers.length) return;
  const currentNames = new Set(players.map((p) => p.name.trim().toLowerCase()));
  const missing = knownPlayers.filter((k) => !currentNames.has(k.name.trim().toLowerCase()));
  if (missing.length === 0) return;

  const rows = missing.map((k) => {
    const skills = {};
    SKILLS.forEach((s) => { skills[s.key] = k[s.key] ?? 0; });
    return { environment: currentEnv, name: k.name, present: false, ...skills };
  });

  const { error } = await supabaseClient.from("players").insert(rows);
  if (error) {
    console.error("Erro ao sincronizar jogadores da base:", error);
    return;
  }
  await loadPlayers();
}

function teardownRealtime() {
  if (playersChannel) supabaseClient.removeChannel(playersChannel);
  if (drawsChannel) supabaseClient.removeChannel(drawsChannel);
  playersChannel = null;
  drawsChannel = null;
}

function subscribeRealtime() {
  playersChannel = supabaseClient
    .channel(`players-${currentEnv}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "players", filter: `environment=eq.${currentEnv}` },
      () => loadPlayers()
    )
    .subscribe();

  drawsChannel = supabaseClient
    .channel(`draws-${currentEnv}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "draws", filter: `environment=eq.${currentEnv}` },
      () => loadDraw()
    )
    .subscribe();
}

// ---------- Known players (shared directory, reused across Quarta/Sexta) ----------
async function loadKnownPlayers() {
  const { data, error } = await supabaseClient
    .from("known_players")
    .select("*")
    .order("name", { ascending: true });

  if (error) {
    console.error(error);
    return;
  }
  knownPlayers = data || [];
  renderKnownPlayers();
}

function subscribeKnownPlayersRealtime() {
  knownPlayersChannel = supabaseClient
    .channel("known-players")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "known_players" },
      () => loadKnownPlayers()
    )
    .subscribe();
}

async function rememberPlayer(name, skills) {
  const { error } = await supabaseClient
    .from("known_players")
    .upsert({ name, ...skills, updated_at: new Date().toISOString() }, { onConflict: "name" });
  if (error) console.error("Erro ao salvar na base de jogadores:", error);
}

async function addKnownPlayerToEnv(known) {
  const skills = {};
  SKILLS.forEach((s) => { skills[s.key] = known[s.key] ?? 0; });
  const { error } = await supabaseClient
    .from("players")
    .insert([{ environment: currentEnv, name: known.name, present: true, ...skills }]);
  if (error) {
    alert("Erro ao adicionar jogador: " + error.message);
    return;
  }
  await loadPlayers();
}

async function deleteKnownPlayer(known) {
  if (!confirm(`Remover "${known.name}" da base de jogadores? Isso não afeta quem já está sorteado hoje, só some da lista de "já jogaram antes".`)) return;
  const { error } = await supabaseClient.from("known_players").delete().eq("id", known.id);
  if (error) {
    alert("Erro ao remover da base de jogadores: " + error.message);
    return;
  }
  await loadKnownPlayers();
}

function renderKnownPlayers() {
  const wrap = document.getElementById("known-players-wrap");
  const list = document.getElementById("known-players-list");
  if (!wrap || !list) return;

  const currentNames = new Set(players.map((p) => p.name.trim().toLowerCase()));
  const available = knownPlayers.filter((k) => !currentNames.has(k.name.trim().toLowerCase()));

  if (available.length === 0) {
    wrap.classList.add("hidden");
    list.innerHTML = "";
    return;
  }
  wrap.classList.remove("hidden");

  list.innerHTML = "";
  available.forEach((k) => {
    const chip = document.createElement("span");
    chip.className = "known-chip";

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "known-chip-add";
    // Nota (média das 4 habilidades) só aparece no modo gerencial.
    const badge = isAdmin ? ` <span class="skill-badge">${overallSkill(k).toFixed(1)}</span>` : "";
    addBtn.innerHTML = `${escapeHtml(k.name)}${badge}`;
    addBtn.addEventListener("click", () => addKnownPlayerToEnv(k));
    chip.appendChild(addBtn);

    // Só a diretoria (modo gerencial) pode apagar alguém da base de jogadores.
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "known-chip-remove admin-only";
    delBtn.title = `Remover ${k.name} da base`;
    delBtn.textContent = "✕";
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteKnownPlayer(k);
    });
    chip.appendChild(delBtn);

    list.appendChild(chip);
  });
}

// ---------- Players CRUD ----------
async function loadPlayers() {
  const { data, error } = await supabaseClient
    .from("players")
    .select("*")
    .eq("environment", currentEnv)
    .order("created_at", { ascending: true });

  if (error) {
    console.error(error);
    setConnStatus("offline");
    return;
  }
  setConnStatus("online");
  players = data || [];
  renderPlayers();
  renderKnownPlayers();
  updateConfigSummary();
}

async function onDeletePlayer(id) {
  if (!confirm("Remover este jogador da planilha de hoje? Como ele continua na base compartilhada, pode voltar a aparecer automaticamente na próxima vez que a página sincronizar. Para removê-lo de vez, use o ✕ no chip amarelo (base de jogadores).")) return;
  const { error } = await supabaseClient.from("players").delete().eq("id", id);
  if (error) {
    alert("Erro ao remover: " + error.message);
    return;
  }
  await loadPlayers();
}

async function onTogglePresent(player, present) {
  const { error } = await supabaseClient
    .from("players")
    .update({ present })
    .eq("id", player.id);
  if (error) {
    alert("Erro ao atualizar presença: " + error.message);
    await loadPlayers();
    return;
  }
  player.present = present;
  updateConfigSummary();
}

async function handleRowChange(existingPlayer, nameInput, skillSelects, saveBtn, presentCheckbox) {
  // Nada é salvo sozinho ao digitar/escolher — só quando este botão "Salvar" é
  // clicado (ou Enter no campo de nome). As estrelas podem ficar em branco e
  // ser preenchidas depois; uma estrela não escolhida mantém a nota atual do
  // jogador (ou 0, se ele ainda não existir).
  const name = nameInput.value.trim();
  if (!name) {
    if (existingPlayer) {
      nameInput.value = existingPlayer.name; // não deixa salvar nome vazio; use o ✕ para remover
    } else {
      alert("Digite o nome do jogador antes de salvar.");
    }
    return;
  }

  const skills = {};
  SKILLS.forEach((s) => {
    const v = skillSelects[s.key].value;
    skills[s.key] = v === "" ? (existingPlayer ? existingPlayer[s.key] : 0) : parseInt(v, 10);
  });

  const present = presentCheckbox ? presentCheckbox.checked : true;
  
    if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = "Salvando…";
  }

  if (existingPlayer) {
    const { error } = await supabaseClient
      .from("players")
      .update({ name, present, ...skills })
      .eq("id", existingPlayer.id);
    if (error) {
      alert("Erro ao atualizar jogador: " + error.message);
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "💾 Salvar"; }
      return;
    }
  } else {
    const { error } = await supabaseClient
      .from("players")
      .insert([{ environment: currentEnv, name, present, ...skills }]);
    if (error) {
      alert("Erro ao adicionar jogador: " + error.message);
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "💾 Salvar"; }
      return;
    }
  }

  // Confirma o jogador (novo ou editado) na base reutilizável "já jogaram antes".
  await rememberPlayer(name, skills);
  await loadPlayers();
}

function renderTableHead() {
  const thead = document.getElementById("players-thead");
  let cols = "<th>Nome</th><th>Presente</th>";
  if (isAdmin) {
    SKILLS.forEach((s) => { cols += `<th class="skill-th">${s.label}</th>`; });
    cols += "<th>Nota</th><th></th>";
  }
  thead.innerHTML = `<tr>${cols}</tr>`;
}

function renderPlayers() {
  renderTableHead();
  const tbody = document.getElementById("players-tbody");
  tbody.innerHTML = "";

  // Non-admins never get blank editable rows — they can't add/edit players or
  // see notas, only the roster that already exists plus a presence checkbox.
  const totalRows = isAdmin ? Math.max(MIN_PLAYER_ROWS, players.length) + extraRows : players.length;

  for (let i = 0; i < totalRows; i++) {
    const p = players[i] || null;
    if (!p && !isAdmin) continue;

    const tr = document.createElement("tr");

    // Nome
    const nameTd = document.createElement("td");
    let nameInput = null;
    if (isAdmin) {
      nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.placeholder = "Nome do jogador";
      nameInput.value = p ? p.name : "";
      nameTd.appendChild(nameInput);
    } else {
      nameTd.textContent = p.name;
    }
    tr.appendChild(nameTd);

    // Presente
const presentTd = document.createElement("td");
        presentTd.style.textAlign = "center";
        let presentCheckbox = null;
        if (p) {
                presentCheckbox = document.createElement("input");
                presentCheckbox.type = "checkbox";
                presentCheckbox.checked = p.present !== false;
                presentCheckbox.addEventListener("change", () => onTogglePresent(p, presentCheckbox.checked));
                presentTd.appendChild(presentCheckbox);
        } else if (isAdmin) {
                presentCheckbox = document.createElement("input");
                presentCheckbox.type = "checkbox";
                presentCheckbox.checked = true;
                presentTd.appendChild(presentCheckbox);
        }
        tr.appendChild(presentTd);

    // Notas de habilidade — só entram no DOM se isAdmin, para não vazar o dado
    // na tela pra quem não tem a senha gerencial.
    if (isAdmin) {
      const skillSelects = {};
      SKILLS.forEach((s) => {
        const td = document.createElement("td");
        td.className = "skill-td";
        const select = document.createElement("select");
        select.className = "skill-select";
        const placeholderOpt = document.createElement("option");
        placeholderOpt.value = "";
        placeholderOpt.textContent = "—";
        select.appendChild(placeholderOpt);
        [0, 1, 2, 3, 4, 5].forEach((n) => {
          const opt = document.createElement("option");
          opt.value = String(n);
          opt.textContent = n === 0 ? "0" : "★".repeat(n);
          select.appendChild(opt);
        });
        select.value = p ? String(p[s.key] ?? 0) : "";
        if (!p) placeholderOpt.selected = true;
        td.appendChild(select);
        tr.appendChild(td);
        skillSelects[s.key] = select;
      });

// Nota - recalcula ao vivo conforme cada habilidade e escolhida (mesma conta de overallSkill: soma das estrelas / qtd habilidades, tratando "-" como 0).

      const notaTd = document.createElement("td");
      notaTd.className = "row-nota";
      const notaSpan = document.createElement("span");
      notaSpan.className = "row-nota-value";
      const updateNota = () => {
        const sum = SKILLS.reduce((acc, s) => acc + (Number(skillSelects[s.key].value) || 0), 0);
        const media = sum / SKILLS.length;
        notaSpan.textContent = `★ ${media.toFixed(2)}`;
      };
      SKILLS.forEach((s) => { skillSelects[s.key].addEventListener("change", updateNota); });
      updateNota();
      notaTd.appendChild(notaSpan);
      tr.appendChild(notaTd);
      const actionTd = document.createElement("td");
      actionTd.className = "row-actions";

      const saveBtn = document.createElement("button");
      saveBtn.type = "button";
      saveBtn.className = "btn-save-mini";
      saveBtn.textContent = "💾 Salvar";
      saveBtn.addEventListener("click", () => handleRowChange(p, nameInput, skillSelects, saveBtn, presentCheckbox));
      actionTd.appendChild(saveBtn);

      if (p) {
        const delBtn = document.createElement("button");
        delBtn.className = "btn-danger-mini";
        delBtn.title = "Remover";
        delBtn.textContent = "✕";
        delBtn.addEventListener("click", () => onDeletePlayer(p.id));
        actionTd.appendChild(delBtn);
      }
      tr.appendChild(actionTd);

      // Enter no campo de nome também salva, sem precisar clicar no botão.
      nameInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") handleRowChange(p, nameInput, skillSelects, saveBtn, presentCheckbox);
      });
    }

    tbody.appendChild(tr);
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Config summary ----------
function updateConfigSummary() {
  const presentCount = players.filter((p) => p.present !== false).length;
  document.getElementById("player-count").textContent = `${presentCount} presentes / ${players.length} total`;
  const numTeams = parseInt(document.getElementById("num-teams").value, 10) || 2;
  const perTeam = presentCount ? (presentCount / numTeams).toFixed(1) : "—";
  document.getElementById("players-per-team").textContent = perTeam;
}

function onNumTeamsChange() {
  const input = document.getElementById("num-teams");
  let val = parseInt(input.value, 10);
  if (isNaN(val) || val < 2) val = 2;
  if (val > 8) val = 8;
  input.value = val;
  updateConfigSummary();
}

// ---------- Draw (sorteio) ----------
async function loadDraw() {
  const { data, error } = await supabaseClient
    .from("draws")
    .select("*")
    .eq("environment", currentEnv)
    .maybeSingle();

  if (error) {
    console.error(error);
    return;
  }

  if (data) {
    currentDraw = data;
    document.getElementById("num-teams").value = data.num_teams;
  } else {
    currentDraw = null;
  }
  updateConfigSummary();
  renderTeams();
}

// Chave estável para um par de jogadores (não depende da ordem dos ids).
function pairKey(idA, idB) {
  return idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
}

// Monta um mapa "par de jogadores" -> "quantas vezes (ponderado por recência)
// jogaram juntos" a partir dos últimos sorteios daquele ambiente. Sorteios
// mais recentes pesam mais, para o algoritmo priorizar desfazer as duplas
// mais "cansadas" primeiro.
function buildPairWeights(historyRows) {
  const weights = new Map();
  historyRows.forEach((row, idx) => {
    const recencyWeight = historyRows.length - idx; // 0 = mais recente, pesa mais
    (row.teams || []).forEach((team) => {
      const ids = (team.players || []).map((p) => p.id).filter(Boolean);
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const key = pairKey(ids[i], ids[j]);
          weights.set(key, (weights.get(key) || 0) + recencyWeight);
        }
      }
    });
  });
  return weights;
}

async function loadRecentDrawHistory(environment, limit) {
  const { data, error } = await supabaseClient
    .from("draw_history")
    .select("teams, draw_date")
    .eq("environment", environment)
    .order("draw_date", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("Erro ao carregar histórico de sorteios:", error);
    return [];
  }
  return data || [];
}

// Distribui os jogadores presentes em `numTeams` times equilibrados.
// Três critérios, do mais para o menos importante:
//   1. Nota geral — a diferença entre o time mais forte e o mais fraco fica
//      a menor possível (mesma lógica de antes).
//   2. Habilidades específicas — evita empilhar num só time os especialistas
//      de uma mesma habilidade (ex.: 2 ótimos atacantes de um lado e nenhum
//      do outro), espalhando quem se destaca em cada habilidade.
//   3. Histórico recente (pairWeights) — entre times igualmente equilibrados,
//      prioriza separar duplas que já jogaram muito juntas ultimamente.
function balanceTeams(playerList, numTeams, pairWeights = new Map()) {
  // Embaralha primeiro para que, com jogadores empatados nos critérios acima,
  // o resultado mude a cada clique em "Sortear" em vez de cair sempre na
  // mesma sequência.
  const shuffled = shuffleArray(playerList);

  // Ordena por "pico de especialidade": quem tem a habilidade isolada mais
  // alta entra primeiro na distribuição, para ser espalhado entre os times
  // antes que as vagas fiquem escassas.
  const withPeak = shuffled.map((player) => {
    let peakSkill = SKILLS[0].key;
    let peakValue = -1;
    SKILLS.forEach((s) => {
      const v = Number(player[s.key]) || 0;
      if (v > peakValue) {
        peakValue = v;
        peakSkill = s.key;
      }
    });
    return { player, peakSkill, peakValue };
  });
  withPeak.sort((a, b) => b.peakValue - a.peakValue || overallSkill(b.player) - overallSkill(a.player));

  const baseSize = Math.floor(shuffled.length / numTeams);
  const remainder = shuffled.length % numTeams;
  const capacities = Array.from({ length: numTeams }, (_, i) => baseSize + (i < remainder ? 1 : 0));

  const teams = Array.from({ length: numTeams }, () => ({
    players: [],
    total: 0,
    skillTotals: Object.fromEntries(SKILLS.map((s) => [s.key, 0])),
  }));

  withPeak.forEach(({ player, peakSkill }) => {
    let bestIdx = -1;
    let bestCost = Infinity;
    teams.forEach((team, idx) => {
      if (team.players.length >= capacities[idx]) return;
      const balanceCost = team.total; // prioridade 1: time mais fraco recebe o próximo
      const specialtyCost = team.skillTotals[peakSkill]; // prioridade 2: espalha especialistas
      const repeatCost = team.players.reduce(
        (acc, tp) => acc + (pairWeights.get(pairKey(tp.id, player.id)) || 0),
        0
      ); // prioridade 3: evita repetir duplas recentes
      const cost = balanceCost * 3 + specialtyCost * 1.5 + repeatCost * 1 + Math.random() * 0.05;
      if (cost < bestCost) {
        bestCost = cost;
        bestIdx = idx;
      }
    });
    if (bestIdx === -1) {
      // fallback: put wherever there is room (shouldn't normally happen)
      bestIdx = teams.findIndex((t, idx) => t.players.length < capacities[idx]);
    }
    teams[bestIdx].players.push(player);
    teams[bestIdx].total += overallSkill(player);
    SKILLS.forEach((s) => {
      teams[bestIdx].skillTotals[s.key] += Number(player[s.key]) || 0;
    });
  });

  return teams.map((t, idx) => ({
    color: TEAM_COLORS[idx % TEAM_COLORS.length],
    players: t.players,
    total: t.total,
    avg: t.players.length ? t.total / t.players.length : 0,
  }));
}

function todayLocalDateStr() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

async function onShuffle() {
  const numTeams = parseInt(document.getElementById("num-teams").value, 10) || 2;
  const presentPlayers = players.filter((p) => p.present !== false);
  if (presentPlayers.length < numTeams) {
    alert(`Marque pelo menos ${numTeams} jogador(es) como presentes para sortear ${numTeams} times.`);
    return;
  }

  const recentHistory = await loadRecentDrawHistory(currentEnv, HISTORY_LOOKBACK);
  const pairWeights = buildPairWeights(recentHistory);

  const teams = balanceTeams(presentPlayers, numTeams, pairWeights);
  const teamsJson = teams.map((t) => ({
    colorName: t.color.name,
    colorHex: t.color.hex,
    players: t.players.map((p) => ({ id: p.id, name: p.name, skill: overallSkill(p) })),
    total: t.total,
    avg: t.avg,
  }));
  const payload = {
    environment: currentEnv,
    num_teams: numTeams,
    teams: teamsJson,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabaseClient.from("draws").upsert(payload, { onConflict: "environment" });
  if (error) {
    alert("Erro ao salvar sorteio: " + error.message);
    return;
  }
  currentDraw = payload;
  renderTeams();

  // Guarda no histórico (para o calendário e para os próximos sorteios
  // saberem quem já jogou junto). Resortear no mesmo dia substitui o
  // registro daquele dia em vez de acumular — não é crítico para o sorteio
  // em si, então uma falha aqui só vai pro console, sem travar a tela.
  const drawDate = todayLocalDateStr();
  const { error: histError } = await supabaseClient.from("draw_history").upsert(
    { environment: currentEnv, draw_date: drawDate, num_teams: numTeams, teams: teamsJson, updated_at: new Date().toISOString() },
    { onConflict: "environment,draw_date" }
  );
  if (histError) {
    console.error("Erro ao salvar histórico do sorteio:", histError);
  } else if (
    calendarMonth.getFullYear() === new Date().getFullYear() &&
    calendarMonth.getMonth() === new Date().getMonth()
  ) {
    loadCalendarMonth();
  }
}

async function onClearDraw() {
  if (!confirm("Limpar o sorteio atual?")) return;
  const { error } = await supabaseClient.from("draws").delete().eq("environment", currentEnv);
  if (error) {
    alert("Erro ao limpar sorteio: " + error.message);
    return;
  }
  currentDraw = null;
  renderTeams();
}

function renderTeams() {
  const panel = document.getElementById("teams-panel");
  const grid = document.getElementById("teams-grid");
  grid.innerHTML = "";

  if (!currentDraw || !currentDraw.teams || currentDraw.teams.length === 0) {
    panel.classList.add("hidden");
    return;
  }

  panel.classList.remove("hidden");

  currentDraw.teams.forEach((team) => {
    const card = document.createElement("div");
    card.className = "team-card";
    card.style.setProperty("--team-color", team.colorHex);

    const playersHtml = team.players
      .map((p) => `<div class="team-player-row"><span>${escapeHtml(p.name)}</span></div>`)
      .join("");
    // Média de habilidade do time só aparece no modo gerencial.
    const avgHtml = isAdmin ? `<span class="team-avg">★ ${team.avg.toFixed(2)}</span>` : "";

    card.innerHTML = `
      <div class="team-card-header">
        <span>${team.colorName}</span>
        ${avgHtml}
      </div>
      <div class="team-card-body">${playersHtml}</div>
    `;
    grid.appendChild(card);
  });
}

// ---------- Calendar (histórico de sorteios por mês) ----------
function subscribeDrawHistoryRealtime() {
  drawHistoryChannel = supabaseClient
    .channel("draw-history")
    .on("postgres_changes", { event: "*", schema: "public", table: "draw_history" }, () => loadCalendarMonth())
    .subscribe();
}

function changeCalendarMonth(delta) {
  calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + delta, 1);
  selectedCalendarDate = null;
  document.getElementById("calendar-detail").classList.add("hidden");
  loadCalendarMonth();
}

async function loadCalendarMonth() {
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  const firstDay = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const lastDate = new Date(year, month + 1, 0).getDate();
  const lastDay = `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDate).padStart(2, "0")}`;

  const { data, error } = await supabaseClient
    .from("draw_history")
    .select("*")
    .gte("draw_date", firstDay)
    .lte("draw_date", lastDay);

  calendarHistory = {};
  if (error) {
    console.error("Erro ao carregar calendário de sorteios:", error);
  } else {
    (data || []).forEach((row) => {
      if (!calendarHistory[row.draw_date]) calendarHistory[row.draw_date] = {};
      calendarHistory[row.draw_date][row.environment] = row;
    });
  }
  renderCalendar();
  if (selectedCalendarDate) renderCalendarDetail(selectedCalendarDate);
}

function renderCalendar() {
  document.getElementById("cal-month-label").textContent =
    `${MONTH_NAMES[calendarMonth.getMonth()]} ${calendarMonth.getFullYear()}`;

  const grid = document.getElementById("calendar-grid");
  grid.innerHTML = "";

  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  for (let i = 0; i < firstWeekday; i++) {
    const empty = document.createElement("div");
    empty.className = "calendar-day empty";
    grid.appendChild(empty);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const dayData = calendarHistory[dateStr];

    const cell = document.createElement("div");
    cell.className = "calendar-day";
    if (dayData) cell.classList.add("has-draw");
    if (dateStr === selectedCalendarDate) cell.classList.add("selected");

    const num = document.createElement("span");
    num.textContent = String(day);
    cell.appendChild(num);

    if (dayData) {
      const badges = document.createElement("span");
      badges.className = "calendar-day-badges";
      badges.textContent = `${dayData.quarta ? "🌅" : ""}${dayData.sexta ? "🌇" : ""}`;
      cell.appendChild(badges);
      cell.addEventListener("click", () => {
        selectedCalendarDate = dateStr;
        renderCalendar();
        renderCalendarDetail(dateStr);
      });
    }

    grid.appendChild(cell);
  }
}

function formatDatePt(dateStr) {
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y}`;
}

function renderCalendarDetail(dateStr) {
  const detail = document.getElementById("calendar-detail");
  const dayData = calendarHistory[dateStr];
  if (!dayData) {
    detail.classList.add("hidden");
    return;
  }
  detail.classList.remove("hidden");
  detail.innerHTML = "";

  ["quarta", "sexta"].forEach((env) => {
    const row = dayData[env];
    if (!row) return;

    const block = document.createElement("div");
    block.className = "calendar-detail-env";

    const title = document.createElement("h3");
    title.textContent = `${env === "quarta" ? "🌅" : "🌇"} ${ENV_LABELS[env]} — ${formatDatePt(dateStr)}`;
    block.appendChild(title);

    const teamsGrid = document.createElement("div");
    teamsGrid.className = "calendar-detail-teams";
    (row.teams || []).forEach((team) => {
      const card = document.createElement("div");
      card.className = "team-card";
      card.style.setProperty("--team-color", team.colorHex);
      const playersHtml = (team.players || [])
        .map((p) => `<div class="team-player-row"><span>${escapeHtml(p.name)}</span></div>`)
        .join("");
      const avgHtml = isAdmin ? `<span class="team-avg">★ ${Number(team.avg || 0).toFixed(2)}</span>` : "";
      card.innerHTML = `
        <div class="team-card-header">
          <span>${team.colorName}</span>
          ${avgHtml}
        </div>
        <div class="team-card-body">${playersHtml}</div>
      `;
      teamsGrid.appendChild(card);
    });
    block.appendChild(teamsGrid);
    detail.appendChild(block);
  });
}

// ---------- Init ----------
document.addEventListener("DOMContentLoaded", initGate);
