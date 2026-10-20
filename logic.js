// ============================================
// Lógica pura (sem DOM) — sorteio por otimização e rotação dos jogos.
// Usada pela aba "Quarta Teste" (novo modelo). Separada do app.js para poder
// ser testada fora do navegador.
// ============================================

// Chave estável para um par de jogadores (não depende da ordem dos ids).
function pairKey(idA, idB) {
  return idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
}

function skillTotal(player, skills) {
  return skills.reduce((acc, s) => acc + (Number(player[s.key]) || 0), 0);
}

function shuffleCopy(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Distribui `playerList` em `numTeams` times. Ordem de prioridade:
//   1. Equilíbrio da SOMA de estrelas: a diferença entre o time mais forte e o
//      mais fraco é a menor possível (e ninguém fica muito acima/abaixo da média).
//   2. Entre as combinações igualmente equilibradas (tolerância de 1 ponto),
//      escolhe a que melhor: garante um levantador decente por time, espalha cada
//      habilidade, equilibra o melhor e o pior jogador de cada time e evita
//      repetir duplas que jogaram juntas recentemente.
// Se os times têm tamanhos diferentes, a comparação usa a força proporcional ao
// tamanho (um time de 3 vale a soma × 4/3 de um time de 4).
// Retorna uma lista de times (cada time = lista de jogadores), em ordem aleatória.
function optimizeTeams(playerList, numTeams, opts) {
  const {
    skills,
    pairWeights = new Map(),
    setterKey = "skill_levantamento",
    setterMin = 3,
    restarts = 150,
    tolerance = 1,
    rng = Math.random,
    keyOf = (p) => p.id,
  } = opts;

  const n = playerList.length;
  const tot = playerList.map((p) => skillTotal(p, skills));
  const perSkill = playerList.map((p) => skills.map((s) => Number(p[s.key]) || 0));
  const setter = playerList.map((p) => Number(p[setterKey]) || 0);

  const baseSize = Math.floor(n / numTeams);
  const remainder = n % numTeams;
  const sizes = Array.from({ length: numTeams }, (_, i) => baseSize + (i < remainder ? 1 : 0));
  const maxSize = Math.max(...sizes);
  const scale = sizes.map((s) => maxSize / s);

  function randomAssignment() {
    const order = shuffleCopy([...Array(n).keys()], rng);
    const assign = new Array(n);
    let k = 0;
    sizes.forEach((size, t) => {
      for (let c = 0; c < size; c++) assign[order[k++]] = t;
    });
    return assign;
  }

  function primaryCost(sums) {
    let min = Infinity;
    let max = -Infinity;
    let total = 0;
    const strengths = sums.map((s, t) => s * scale[t]);
    strengths.forEach((s) => {
      if (s < min) min = s;
      if (s > max) max = s;
      total += s;
    });
    const mean = total / numTeams;
    let variance = 0;
    strengths.forEach((s) => { variance += (s - mean) * (s - mean); });
    return (max - min) * 1000 + variance;
  }

  // Descida por trocas: troca dois jogadores de times diferentes enquanto isso
  // melhorar o equilíbrio da soma.
  function localSearchPrimary(assign) {
    const sums = new Array(numTeams).fill(0);
    assign.forEach((t, i) => { sums[t] += tot[i]; });
    let cost = primaryCost(sums);
    for (let pass = 0; pass < 200; pass++) {
      let bestGain = 0;
      let bi = -1;
      let bj = -1;
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const a = assign[i];
          const b = assign[j];
          if (a === b) continue;
          const d = tot[j] - tot[i];
          if (d === 0) continue;
          sums[a] += d;
          sums[b] -= d;
          const c = primaryCost(sums);
          sums[a] -= d;
          sums[b] += d;
          if (cost - c > bestGain + 1e-9) {
            bestGain = cost - c;
            bi = i;
            bj = j;
          }
        }
      }
      if (bi < 0) break;
      const a = assign[bi];
      const b = assign[bj];
      const d = tot[bj] - tot[bi];
      sums[a] += d;
      sums[b] -= d;
      assign[bi] = b;
      assign[bj] = a;
      cost -= bestGain;
    }
    return assign;
  }

  function evaluate(assign) {
    const members = Array.from({ length: numTeams }, () => []);
    assign.forEach((t, i) => members[t].push(i));
    const strengths = members.map((m, t) => m.reduce((acc, i) => acc + tot[i], 0) * scale[t]);
    const range = (vals) => Math.max(...vals) - Math.min(...vals);
    const spread = range(strengths);

    let skillSpread = 0;
    for (let k = 0; k < skills.length; k++) {
      skillSpread += range(members.map((m, t) => m.reduce((acc, i) => acc + perSkill[i][k], 0) * scale[t]));
    }
    const setterPen = members.reduce((acc, m) => acc + Math.max(0, setterMin - Math.max(...m.map((i) => setter[i]))), 0);
    const topSpread = range(members.map((m) => Math.max(...m.map((i) => tot[i]))));
    const weakSpread = range(members.map((m) => Math.min(...m.map((i) => tot[i]))));
    let repeat = 0;
    members.forEach((m) => {
      for (let x = 0; x < m.length; x++) {
        for (let y = x + 1; y < m.length; y++) {
          repeat += pairWeights.get(pairKey(keyOf(playerList[m[x]]), keyOf(playerList[m[y]]))) || 0;
        }
      }
    });
    const secondary = setterPen * 20 + skillSpread * 1.5 + topSpread * 0.5 + weakSpread * 0.5 + repeat * 0.5;
    return { spread, secondary, skillSpread, setterPen, topSpread, weakSpread, repeat };
  }

  // Melhora o critério secundário sem deixar a diferença de soma passar do limite.
  function improveSecondary(assign, limit) {
    let cur = evaluate(assign);
    for (let pass = 0; pass < 30; pass++) {
      let best = null;
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const a = assign[i];
          const b = assign[j];
          if (a === b) continue;
          assign[i] = b;
          assign[j] = a;
          const ev = evaluate(assign);
          assign[i] = a;
          assign[j] = b;
          if (ev.spread <= limit + 1e-9 && ev.secondary < (best ? best.ev.secondary : cur.secondary) - 1e-9) {
            best = { i, j, ev };
          }
        }
      }
      if (!best) break;
      const a = assign[best.i];
      assign[best.i] = assign[best.j];
      assign[best.j] = a;
      cur = best.ev;
    }
    return cur;
  }

  const pool = [];
  for (let r = 0; r < restarts; r++) {
    const assign = localSearchPrimary(randomAssignment());
    pool.push({ assign, ev: evaluate(assign) });
  }
  const minSpread = Math.min(...pool.map((c) => c.ev.spread));
  const limit = minSpread + tolerance;
  const finalists = pool
    .filter((c) => c.ev.spread <= limit + 1e-9)
    .sort((a, b) => a.ev.secondary - b.ev.secondary)
    .slice(0, 6);
  finalists.forEach((c) => { c.ev = improveSecondary(c.assign, limit); });
  finalists.sort((a, b) => a.ev.secondary - b.ev.secondary);

  // Sorteia entre os 3 melhores para o resultado variar a cada clique.
  const pick = finalists[Math.floor(rng() * Math.min(3, finalists.length))];
  const teams = Array.from({ length: numTeams }, () => []);
  pick.assign.forEach((t, i) => teams[t].push(playerList[i]));
  teams.forEach((t) => t.sort((a, b) => skillTotal(b, skills) - skillTotal(a, skills)));
  return shuffleCopy(teams, rng);
}

// Reproduz a ordem dos jogos da noite a partir da ordem dos times no sorteio e
// da lista de jogos já registrados (cada jogo só precisa saber o vencedor).
//  - O 1º time enfrenta o 2º; quem perde vai para o fim da fila e entra o próximo.
//  - Quem chega a `streakLimit` vitórias seguidas sai JUNTO com o time que perdeu
//    esse jogo: entram os 2 primeiros da fila, o vencedor volta como 1º da fila e o
//    perdedor como último. (Com menos de 2 times na fila a regra não se aplica.)
function computeRotation(teamNames, games, streakLimit) {
  const wins = {};
  const record = {};
  teamNames.forEach((n) => {
    wins[n] = 0;
    record[n] = { games: 0, wins: 0, losses: 0 };
  });
  let court = teamNames.slice(0, 2);
  let queue = teamNames.slice(2);
  const skipped = [];

  games.forEach((g) => {
    if (court.length < 2 || !court.includes(g.winner)) {
      skipped.push(g);
      return;
    }
    const winner = g.winner;
    const loser = court[0] === winner ? court[1] : court[0];
    record[winner].games++;
    record[winner].wins++;
    record[loser].games++;
    record[loser].losses++;
    wins[winner] += 1;
    wins[loser] = 0;

    if (streakLimit && wins[winner] >= streakLimit && queue.length >= 2) {
      const entering = [queue.shift(), queue.shift()];
      queue = [winner, ...queue, loser];
      wins[winner] = 0;
      court = entering;
    } else {
      queue.push(loser);
      court = [winner, queue.shift()];
    }
  });

  return { court, queue, wins, record, skipped };
}
