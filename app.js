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

  loadKnownPlayers();
  subscribeKnownPlayersRealtime();

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

function balanceTeams(playerList, numTeams) {
  // Embaralha primeiro para que, com jogadores de nota igual (ou empatada no
  // arredondamento), o resultado mude a cada clique em "Sortear" — sort() do
  // JS é estável, então o empate entre iguais mantém a ordem embaralhada em
  // vez de sempre cair na mesma sequência.
  const shuffled = shuffleArray(playerList);
  const sorted = shuffled.sort((a, b) => overallSkill(b) - overallSkill(a));
  const baseSize = Math.floor(sorted.length / numTeams);
  const remainder = sorted.length % numTeams;
  const capacities = Array.from({ length: numTeams }, (_, i) => baseSize + (i < remainder ? 1 : 0));

  const teams = Array.from({ length: numTeams }, () => ({ players: [], total: 0 }));

  sorted.forEach((player) => {
    let bestIdx = -1;
    let bestTotal = Infinity;
    teams.forEach((team, idx) => {
      if (team.players.length >= capacities[idx]) return;
      if (team.total < bestTotal) {
        bestTotal = team.total;
        bestIdx = idx;
      }
    });
    if (bestIdx === -1) {
      // fallback: put wherever there is room (shouldn't normally happen)
      bestIdx = teams.findIndex((t, idx) => t.players.length < capacities[idx]);
    }
    teams[bestIdx].players.push(player);
    teams[bestIdx].total += overallSkill(player);
  });

  return teams.map((t, idx) => ({
    color: TEAM_COLORS[idx % TEAM_COLORS.length],
    players: t.players,
    total: t.total,
    avg: t.players.length ? t.total / t.players.length : 0,
  }));
}

async function onShuffle() {
  const numTeams = parseInt(document.getElementById("num-teams").value, 10) || 2;
  const presentPlayers = players.filter((p) => p.present !== false);
  if (presentPlayers.length < numTeams) {
    alert(`Marque pelo menos ${numTeams} jogador(es) como presentes para sortear ${numTeams} times.`);
    return;
  }

  const teams = balanceTeams(presentPlayers, numTeams);
  const payload = {
    environment: currentEnv,
    num_teams: numTeams,
    teams: teams.map((t) => ({
      colorName: t.color.name,
      colorHex: t.color.hex,
      players: t.players.map((p) => ({ id: p.id, name: p.name, skill: overallSkill(p) })),
      total: t.total,
      avg: t.avg,
    })),
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabaseClient.from("draws").upsert(payload, { onConflict: "environment" });
  if (error) {
    alert("Erro ao salvar sorteio: " + error.message);
    return;
  }
  currentDraw = payload;
  renderTeams();
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

// ---------- Init ----------
document.addEventListener("DOMContentLoaded", initGate);
