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

let supabaseClient = null;
let currentEnv = "quarta";
let players = []; // players for current env
let currentDraw = null; // { num_teams, teams }
let playersChannel = null;
let drawsChannel = null;
let extraRows = 0; // blank rows added beyond the minimum, via "+ Adicionar linha"
const MIN_PLAYER_ROWS = 20;
let knownPlayers = []; // shared directory of every player ever added, across both days
let knownPlayersChannel = null;

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
  await loadDraw();
  subscribeRealtime();
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

async function rememberPlayer(name, skill) {
  const { error } = await supabaseClient
    .from("known_players")
    .upsert({ name, skill, updated_at: new Date().toISOString() }, { onConflict: "name" });
  if (error) console.error("Erro ao salvar na base de jogadores:", error);
}

async function addKnownPlayerToEnv(known) {
  const { error } = await supabaseClient
    .from("players")
    .insert([{ environment: currentEnv, name: known.name, skill: known.skill }]);
  if (error) {
    alert("Erro ao adicionar jogador: " + error.message);
    return;
  }
  await loadPlayers();
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
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "known-chip";
    chip.innerHTML = `${escapeHtml(k.name)} <span class="skill-badge">${k.skill}</span>`;
    chip.addEventListener("click", () => addKnownPlayerToEnv(k));
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
  if (!confirm("Remover este jogador?")) return;
  const { error } = await supabaseClient.from("players").delete().eq("id", id);
  if (error) {
    alert("Erro ao remover: " + error.message);
    return;
  }
  await loadPlayers();
}

async function handleRowChange(existingPlayer, nameInput, skillSelect) {
  const name = nameInput.value.trim();
  const skill = parseInt(skillSelect.value, 10);

  if (existingPlayer) {
    // Row tied to a player already saved in the database.
    if (!name) {
      // Don't auto-delete on empty name; revert and let the ✕ button handle removal.
      nameInput.value = existingPlayer.name;
      return;
    }
    if (!skill) return; // wait until a nota is chosen
    if (name === existingPlayer.name && skill === existingPlayer.skill) return;

    const { error } = await supabaseClient
      .from("players")
      .update({ name, skill })
      .eq("id", existingPlayer.id);
    if (error) {
      alert("Erro ao atualizar jogador: " + error.message);
      return;
    }
    await rememberPlayer(name, skill);
    await loadPlayers();
  } else {
    // Blank row: only save once both fields are filled in.
    if (!name || !skill) return;

    const { error } = await supabaseClient
      .from("players")
      .insert([{ environment: currentEnv, name, skill }]);
    if (error) {
      alert("Erro ao adicionar jogador: " + error.message);
      return;
    }
    await rememberPlayer(name, skill);
    await loadPlayers();
  }
}

function renderPlayers() {
  const tbody = document.getElementById("players-tbody");
  tbody.innerHTML = "";

  const totalRows = Math.max(MIN_PLAYER_ROWS, players.length) + extraRows;

  for (let i = 0; i < totalRows; i++) {
    const p = players[i] || null;
    const tr = document.createElement("tr");

    const nameTd = document.createElement("td");
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.placeholder = "Nome do jogador";
    nameInput.value = p ? p.name : "";
    nameTd.appendChild(nameInput);

    const skillTd = document.createElement("td");
    const skillSelect = document.createElement("select");
    const placeholderOpt = document.createElement("option");
    placeholderOpt.value = "";
    placeholderOpt.textContent = "Nota";
    placeholderOpt.disabled = true;
    skillSelect.appendChild(placeholderOpt);
    [1, 2, 3, 4, 5].forEach((n) => {
      const opt = document.createElement("option");
      opt.value = String(n);
      opt.textContent = String(n);
      skillSelect.appendChild(opt);
    });
    skillSelect.value = p ? String(p.skill) : "";
    if (!p) placeholderOpt.selected = true;
    skillTd.appendChild(skillSelect);

    const actionTd = document.createElement("td");
    actionTd.style.textAlign = "right";
    if (p) {
      const delBtn = document.createElement("button");
      delBtn.className = "btn-danger-mini";
      delBtn.title = "Remover";
      delBtn.textContent = "✕";
      delBtn.addEventListener("click", () => onDeletePlayer(p.id));
      actionTd.appendChild(delBtn);
    }

    tr.appendChild(nameTd);
    tr.appendChild(skillTd);
    tr.appendChild(actionTd);
    tbody.appendChild(tr);

    const saveHandler = () => handleRowChange(p, nameInput, skillSelect);
    nameInput.addEventListener("blur", saveHandler);
    skillSelect.addEventListener("change", saveHandler);
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Config summary ----------
function updateConfigSummary() {
  document.getElementById("player-count").textContent = players.length;
  const numTeams = parseInt(document.getElementById("num-teams").value, 10) || 2;
  const perTeam = players.length ? (players.length / numTeams).toFixed(1) : "—";
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
  const sorted = [...playerList].sort((a, b) => b.skill - a.skill);
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
    teams[bestIdx].total += player.skill;
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
  if (players.length < numTeams) {
    alert(`Cadastre pelo menos ${numTeams} jogador(es) para sortear ${numTeams} times.`);
    return;
  }

  const teams = balanceTeams(players, numTeams);
  const payload = {
    environment: currentEnv,
    num_teams: numTeams,
    teams: teams.map((t) => ({
      colorName: t.color.name,
      colorHex: t.color.hex,
      players: t.players.map((p) => ({ id: p.id, name: p.name, skill: p.skill })),
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

    card.innerHTML = `
      <div class="team-card-header">
        <span>${team.colorName}</span>
        <span class="team-avg">★ ${team.avg.toFixed(2)}</span>
      </div>
      <div class="team-card-body">${playersHtml}</div>
    `;
    grid.appendChild(card);
  });
}

// ---------- Init ----------
document.addEventListener("DOMContentLoaded", initGate);
