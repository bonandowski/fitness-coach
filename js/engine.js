// Motore di raccomandazione: nessun LLM, solo regole + punteggio + ricerca.
//
// 1. VINCOLI DURI: finestre minime di recupero (GAPS) verso il passato e verso
//    il futuro già pianificato, check-in del giorno, fastidio attivo.
// 2. PUNTEGGIO MORBIDO: bisogno di ciascun obiettivo settimanale (quanto è in
//    ritardo), alternanza, varietà, volume settimanale, giorni di fila,
//    carico acuto/cronico, preferenze.
// 3. RICERCA: beam search sui prossimi giorni, così il piano di oggi tiene
//    conto di cosa serve domani e di cosa hai già fissato (es. calcetto).

import {
  TYPES, SUGGESTABLE, TRAINING, GAPS, DOWNGRADE, LEG_DEMANDING, SPRINT_OR_HEAVY,
  SLOT_TARGETS, SLOT_LABELS, BASE,
} from './catalog.js';

const DAY = 864e5;
const pad = (x) => String(x).padStart(2, '0');
export const toN = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY);
};
export const toS = (n) => new Date(n * DAY).toISOString().slice(0, 10);
export const weekday = (n) => new Date(n * DAY).getUTCDay(); // 0 = domenica
export const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export const DEFAULT_SETTINGS = {
  calcettoDay: 0, // domenica
  assumeCalcetto: true, // se non indichi nulla, considera probabile il calcetto
  restDays: [0, 6], // giorni in cui preferisci riposare
  weeklyTarget: 4.5, // giorni di allenamento a settimana
  noCalcetto: [], // date in cui hai detto "niente calcetto"
};

const T = (t) => TYPES[t] || TYPES.other;
const lbl = (t) => T(t).label;
const lower = (t) => lbl(t).toLowerCase();

const ago = (g) => (g === 0 ? 'oggi' : g === 1 ? 'ieri' : `${g} giorni fa`);
const inDays = (g) => (g === 0 ? 'oggi' : g === 1 ? 'domani' : `tra ${g} giorni`);

export function isHardLegs(item) {
  if (item.type === 'hike') return (item.dur ?? T('hike').dur) >= 150;
  return !!T(item.type).hardLegs;
}

// Finestra minima [hard, ideal] tra una seduta `prev` e una seduta di tipo `nextType`.
export function gapReq(prev, nextType) {
  const row = GAPS[prev.type] || {};
  let [hard, ideal] = row[nextType] || [0, 0];
  const t = T(prev.type);
  const rpe = prev.rpe ?? t.rpe;
  const dur = prev.dur ?? t.dur;
  // Seduta dura ma blanda (RPE <= 4): recupero più rapido (es. calcetto blando 24-36h).
  if (t.hard && rpe && rpe <= 4) {
    hard = Math.max(hard > 0 ? 1 : 0, hard - 1);
    ideal = ideal - 1;
  }
  // Montagna: lunga = più eccentrica, corta = quasi una camminata.
  if (prev.type === 'hike') {
    if (dur >= 240) {
      ideal += 1;
      if (hard > 0) hard += 1;
    } else if (dur <= 120) {
      hard = Math.max(0, hard - 1);
      ideal -= 1;
    }
  }
  // Seduta massimale: serve un giorno in più per stare bene.
  if (rpe >= 9 && ideal > 0) ideal += 1;
  // Mai due sedute dure sulle gambe consecutive.
  if (isHardLegs({ ...prev, dur }) && isHardLegs({ type: nextType })) {
    hard = Math.max(hard, 2);
    ideal = Math.max(ideal, 2);
  }
  return [hard, Math.max(hard, ideal)];
}

const item = (e) => {
  const t = T(e.type);
  return {
    n: toN(e.date), type: e.type, dur: e.dur ?? t.dur, rpe: e.rpe ?? t.rpe,
    status: e.status, id: e.id, ghost: false,
  };
};

export const loadOf = (e) => (e.dur ?? T(e.type).dur) * (e.rpe ?? T(e.type).rpe);

function buildContext(state, todayS) {
  const today = toN(todayS);
  const s = { ...DEFAULT_SETTINGS, ...(state.settings || {}) };
  const all = (state.entries || []).filter((e) => e.status !== 'skipped').map(item);
  const history = all.filter((e) => e.status === 'done' && e.n < today);

  // Carico acuto (7 gg) / cronico (media settimanale 28 gg).
  const doneAll = all.filter((e) => e.status === 'done' && e.n <= today);
  const sumLoad = (from) => doneAll.filter((e) => e.n > today - from).reduce((a, e) => a + loadOf(e), 0);
  const acute = sumLoad(7);
  const chronic = sumLoad(28) / 4;
  // Serve almeno 3 settimane di storico perché il rapporto abbia senso.
  const first = doneAll.reduce((m, e) => Math.min(m, e.n), Infinity);
  const acwr = chronic >= 250 && first <= today - 21 ? acute / chronic : null;

  const recentTraining = history.some((e) => TRAINING(e.type) && e.n >= today - 10);
  const returning = history.length > 0 && !recentTraining;

  const in28 = history.filter((e) => e.n >= today - 28);
  const slotSum = (slot) => in28.reduce((a, e) => a + (T(e.type).slots[slot] || 0), 0);

  const targets = { ...SLOT_TARGETS };
  return {
    today, s, all, history, acwr, acute, chronic, returning, targets,
    pull28: slotSum('pull'), push28: slotSum('push'),
    checkin: (state.checkins || {})[todayS] || null,
    pain: !!(state.flags && state.flags.pain),
  };
}

function fixedFor(ctx, n) {
  const fixed = ctx.all.filter((e) => e.n === n && (n >= ctx.today));
  if (fixed.length) return fixed;
  const { s } = ctx;
  if (s.assumeCalcetto && weekday(n) === s.calcettoDay && !s.noCalcetto.includes(toS(n))) {
    return [{ n, type: 'calcetto', dur: T('calcetto').dur, rpe: T('calcetto').rpe, ghost: true }];
  }
  return [];
}

// Valuta il tipo `cand` nel giorno `d`, dati gli elementi precedenti e quelli futuri fissati.
export function evaluate(cand, d, prior, future, ctx) {
  const t = T(cand);
  const notes = [];
  const blocks = [];
  const add = (v, txt) => { if (v) notes.push({ v, t: txt }); };
  let base = BASE[cand] ?? 0;
  const training = TRAINING(cand);

  // 1. Finestre di recupero verso il passato.
  for (const p of prior) {
    const gap = d - p.n;
    if (gap < 0 || gap > 4 || !TRAINING(p.type)) continue;
    const [h, i] = gapReq(p, cand);
    if (gap < h) blocks.push(`${lbl(p.type)} ${ago(gap)}: per ${lower(cand)} servono ${h} giorni`);
    else if (gap < i) add(-1.5 * (i - gap), `${lbl(p.type)} ${ago(gap)}: per ${lower(cand)} meglio ${i} giorni`);
  }

  // 2. Finestre verso il futuro già pianificato (o probabile calcetto).
  for (const f of future) {
    const gap = f.n - d;
    if (gap < 0 || gap > 4 || !TRAINING(f.type)) continue;
    const name = f.ghost ? `Probabile ${lower(f.type)} ${inDays(gap)}` : `${lbl(f.type)} ${inDays(gap)}`;
    const [h, i] = gapReq({ type: cand, dur: t.dur, rpe: t.rpe }, f.type);
    if (gap < h) {
      const msg = `${name}: ${lower(cand)} va fatto almeno ${h} giorni prima`;
      if (f.ghost) add(-4, msg); else blocks.push(msg);
    } else if (gap < i) {
      add(-1.5 * (i - gap) * (f.ghost ? 0.6 : 1), `${name}: meglio ${i} giorni di margine`);
    }
  }

  // 3. Il giorno prima del calcetto: defaticante da 20' o riposo.
  const tomorrow = future.find((f) => f.n === d + 1 && f.type === 'calcetto');
  if (tomorrow) {
    const who = tomorrow.ghost ? 'Domani probabile calcetto' : 'Domani calcetto';
    if (cand === 'run_easy') add(3, `${who}: defaticante da 20', come piace a te`);
    else if (cand === 'rest') add(1.5, `${who}: arrivaci fresco`);
    else if (training) {
      const msg = `${who}: il giorno prima solo defaticante o riposo`;
      if (tomorrow.ghost) add(-4, msg); else blocks.push(msg);
    }
  }
  if (future.some((f) => f.n === d && f.type === 'calcetto') && training) {
    blocks.push('Giorno di calcetto: niente altro allenamento');
  }

  // 4. Segnali soggettivi (hanno la priorità).
  const c = ctx.checkin;
  if (c && d === ctx.today) {
    if (c.legs === 'hard' && LEG_DEMANDING.includes(cand)) blocks.push('Quadricipiti induriti: oggi niente gambe né corsa impegnativa');
    if (c.legs === 'pain' && (LEG_DEMANDING.includes(cand) || cand === 'run_easy')) blocks.push('Dolore localizzato: oggi solo parte alta e mobilità');
    if (c.legs === 'hard' && cand === 'run_easy') add(0.8, 'Una corsa facile aiuta a sciogliere i quadricipiti');
    if ((c.stiff || c.energy === 'low') && cand === 'mobility') add(1.2, 'Rigido o scarico: la mobilità rimette in moto');
    if (c.energy === 'low' && cand === 'rest') add(1.5, 'Energia bassa: oggi recuperare vale più di allenarsi');
    if (c.energy === 'high' && t.hard) add(0.6, 'Energia alta: buona giornata per una seduta dura');
  }
  if (c && d === ctx.today + 1) {
    if (c.legs === 'pain' && SPRINT_OR_HEAVY.includes(cand)) blocks.push('Dolore alle gambe oggi: domani ancora niente gambe pesanti o sprint');
    if (c.legs === 'hard' && SPRINT_OR_HEAVY.includes(cand)) add(-2, 'Quadricipiti induriti oggi: domani vacci piano');
  }
  if (ctx.pain && SPRINT_OR_HEAVY.includes(cand)) {
    blocks.push('Fastidio che tira attivo: stop a gambe pesanti, sprint e salite finché non passa');
  }

  // 5. Bisogno degli obiettivi settimanali.
  for (const [slot, w] of Object.entries(t.slots)) {
    const target = ctx.targets[slot];
    if (!target) continue;
    const interval = 7 / target;
    let last = null;
    for (const p of prior) {
      if (p.n < d && p.n >= d - 14 && (T(p.type).slots[slot] || 0) >= 0.6 && (last === null || p.n > last)) last = p.n;
    }
    const since = last === null ? 14 : d - last;
    const r = Math.min(since / interval, 2);
    const v = w * (3 * r - 2);
    const txt = last === null
      ? `${SLOT_LABELS[slot]}: niente negli ultimi 14 giorni`
      : `${SLOT_LABELS[slot]}: ultima volta ${ago(since)}`;
    add(v, txt);
  }

  // Varietà nella corsa di qualità: preferisci quella fatta meno di recente.
  const QUALITY = ['hills_short', 'hills_long', 'run_strides'];
  if (QUALITY.includes(cand)) {
    const lastOf = (q) => prior.reduce((m, p) => (p.type === q && p.n > m ? p.n : m), -Infinity);
    const oldest = QUALITY.reduce((a, q) => (lastOf(q) < lastOf(a) ? q : a), QUALITY[0]);
    if (oldest === cand && lastOf(cand) > -Infinity) add(0.5, 'Varia lo stimolo di corsa');
    else if (lastOf(cand) === -Infinity) add(0.3, '');
  }

  // Alternanza spinta/tirata e postura.
  if (cand === 'pull' || cand === 'push') {
    const lastUpper = prior
      .filter((p) => ['push', 'pull'].includes(p.type) && p.n < d && p.n >= d - 7)
      .sort((a, b) => b.n - a.n)[0];
    if (lastUpper && lastUpper.type !== cand) add(0.7, `Alterna: l'ultima parte alta era ${lower(lastUpper.type)}`);
    if (cand === 'pull' && ctx.pull28 < ctx.push28) add(0.8, 'Postura: ultimamente più spinta che tirata, riequilibra');
    else if (cand === 'pull' && ctx.pull28 === ctx.push28) add(0.3, '');
    if (c && d === ctx.today && (c.stiff || c.energy === 'low')) add(0, 'Oggi riduci il volume di un terzo');
  }

  // 6. Volume settimanale e giorni consecutivi.
  const win = prior.filter((p) => p.n >= d - 6 && p.n < d && TRAINING(p.type));
  const trainDays = new Set(win.map((p) => p.n)).size;
  let streak = 0;
  for (let k = d - 1; k >= d - 7 && win.some((p) => p.n === k); k--) streak++;
  if (training) {
    const over = trainDays + 1 - ctx.s.weeklyTarget;
    if (over > 0) add(-2 * over, `Già ${trainDays} giorni di allenamento negli ultimi 7`);
    if (streak >= 3) add(-(2 + (streak - 3) * 1.5), `${streak} giorni di fila: serve staccare`);
  } else if (cand === 'rest') {
    if (trainDays >= ctx.s.weeklyTarget - 1) add(1, `${trainDays} giorni di allenamento negli ultimi 7`);
    if (streak >= 3) add(1 + (streak - 3), `${streak} giorni di fila senza riposo`);
    if (streak >= 6) add(4, 'Serve almeno un giorno di riposo completo a settimana');
    // Due riposi di fila solo se servono davvero.
    if (streak === 0 && prior.some((p) => p.n < d - 1)) add(-1, 'Ieri hai già riposato');
  }

  // Alternanza duro/facile.
  if (t.hard) {
    const y = prior.find((p) => p.n === d - 1 && T(p.type).hard);
    if (y) add(-1.5, `Ieri ${lower(y.type)}: alterna duro e facile`);
    const tm = future.find((f) => f.n === d + 1 && T(f.type).hard && !f.ghost);
    if (tm) add(-1, `Domani ${lower(tm.type)}: oggi meglio qualcosa di più leggero`);
  }
  if (cand === 'mobility' && prior.some((p) => p.n === d - 1 && T(p.type).hard)) add(0.6, 'Dopo una seduta dura la mobilità aiuta il recupero');

  // Giorni in cui di solito riposi.
  if (ctx.s.restDays.includes(weekday(d))) {
    if (cand === 'rest') add(1.5, 'Di solito in questo giorno riposi');
    else if (training) add(-0.8, '');
  }

  // 7. Carico acuto/cronico e rientro da pausa.
  if (ctx.acwr !== null) {
    if (t.hard && ctx.acwr > 1.5) add(-4, `Carico ultima settimana molto sopra la tua media (×${ctx.acwr.toFixed(1)})`);
    else if (t.hard && ctx.acwr > 1.3) add(-2, `Carico ultima settimana sopra la tua media (×${ctx.acwr.toFixed(1)})`);
    if (cand === 'rest' && ctx.acwr > 1.3) add(1.5, 'Carico in forte crescita: un giorno di scarico');
  }
  if (ctx.returning && t.hard && d - ctx.today < 3) add(-3, 'Rientri da una pausa: riparti con sedute moderate');

  const score = base + notes.reduce((a, x) => a + x.v, 0);
  return { type: cand, score, blocks, notes };
}

// Candidati per il giorno d, con la regola "scala di un livello" applicata oggi.
function candidatesFor(d, prior, future, ctx) {
  const evals = Object.fromEntries(SUGGESTABLE.map((c) => [c, evaluate(c, d, prior, future, ctx)]));
  const c = ctx.checkin;
  const downgrade = d === ctx.today && c && (c.stiff || c.energy === 'low');
  if (!downgrade) return SUGGESTABLE.map((k) => evals[k]);

  const why = c.stiff ? 'rigidità generale' : 'energia bassa';
  const out = {};
  const put = (x) => { if (!out[x.type] || (x.blocks.length === 0 && (out[x.type].blocks.length > 0 || x.score > out[x.type].score))) out[x.type] = x; };
  for (const k of SUGGESTABLE) {
    const e = evals[k];
    const to = DOWNGRADE[k];
    if (!to) { put(e); continue; }
    put({ ...e, blocks: e.blocks.length ? e.blocks : [`Con ${why} scala a ${lower(to)}`], downgraded: true });
    const et = evals[to];
    if (e.blocks.length === 0 && et.blocks.length === 0) {
      put({
        type: to, score: e.score - 0.5, blocks: [], from: k,
        notes: [{ v: 0.01, t: `Avresti fatto ${lower(k)}: con ${why} scala di un livello` }, ...e.notes],
      });
    }
  }
  return Object.values(out);
}

const reasonsOf = (ev) => {
  const pos = ev.notes.filter((x) => x.v > 0 && x.t).sort((a, b) => b.v - a.v);
  const neg = ev.notes.filter((x) => x.v <= -0.9 && x.t).sort((a, b) => a.v - b.v);
  const first = ev.from ? pos.filter((x) => x.v === 0.01) : [];
  return {
    reasons: [...first, ...pos.filter((x) => x.v !== 0.01 && x.v > 0.4)].slice(0, 3).map((x) => x.t),
    cautions: neg.slice(0, 2).map((x) => x.t),
  };
};

const BEAM = 60;

// "Debito" accumulato a fine giornata per ogni obiettivo in ritardo. Nella
// ricerca rende conveniente recuperare subito ciò che è in ritardo invece di
// rimandarlo (rimandare costa un po' ogni giorno che passa).
function slotDebt(items, d, ctx) {
  let debt = 0;
  for (const [slot, target] of Object.entries(ctx.targets)) {
    const interval = 7 / target;
    let last = d - 14;
    for (const p of items) {
      if (p.n <= d && p.n > last && (T(p.type).slots[slot] || 0) >= 0.6) last = p.n;
    }
    const over = (d - last) / interval - 1;
    if (over > 0) debt += over * 1.2;
  }
  return debt;
}

// Piano per i prossimi `horizon` giorni a partire da oggi.
export function plan(state, todayS, { horizon = 9 } = {}) {
  const ctx = buildContext(state, todayS);
  const { today, history } = ctx;
  const end = today + horizon;
  const fixed = {};
  for (let n = today; n < end + 5; n++) fixed[n] = fixedFor(ctx, n);
  const futureAfter = (d) => {
    const out = [];
    for (let n = d; n < end + 5; n++) for (const f of fixed[n]) if (n > d || f.type === 'calcetto') out.push(f);
    return out;
  };

  let beams = [{ items: [], score: 0 }];
  for (let d = today; d < end; d++) {
    const fx = fixed[d];
    const future = futureAfter(d);
    const next = [];
    for (const b of beams) {
      if (fx.length) {
        const items = b.items.concat(fx);
        next.push({ items, score: b.score - slotDebt(history.concat(items), d, ctx) });
        continue;
      }
      const prior = history.concat(b.items);
      for (const c of candidatesFor(d, prior, future, ctx)) {
        if (c.blocks.length) continue;
        const t = T(c.type);
        const items = b.items.concat([{ n: d, type: c.type, dur: t.dur, rpe: t.rpe, virtual: true }]);
        next.push({
          items,
          // Leggera preferenza per decidere bene i giorni vicini.
          score: b.score + c.score * (1 - (d - today) * 0.02) - slotDebt(prior.concat(items.slice(-1)), d, ctx),
        });
      }
    }
    next.sort((a, b) => b.score - a.score);
    beams = next.slice(0, BEAM);
  }
  const best = beams[0] || { items: [] };

  const days = [];
  for (let d = today; d < end; d++) {
    const prior = history.concat(best.items.filter((x) => x.n < d));
    const future = futureAfter(d);
    const fx = fixed[d];
    const day = { date: toS(d), n: d, isToday: d === today, ghost: fx.some((f) => f.ghost), warnings: {} };
    const ranked = () => candidatesFor(d, prior, future, ctx).sort((a, b) => b.score - a.score);

    if (fx.length && !day.ghost) {
      // Controlla che il piano dell'utente rispetti le regole.
      let anyBlocked = false;
      for (const f of fx) {
        if (f.status !== 'planned' || !T(f.type).suggest) continue;
        const others = fx.filter((o) => o !== f);
        const ev = candidatesFor(d, prior.concat(others), future, ctx).find((x) => x.type === f.type)
          || evaluate(f.type, d, prior.concat(others), future, ctx);
        const r = reasonsOf(ev);
        const warn = [...ev.blocks, ...r.cautions];
        if (warn.length) day.warnings[f.id] = warn;
        if (ev.blocks.length) anyBlocked = true;
      }
      if (anyBlocked) {
        const alt = ranked().filter((x) => !x.blocks.length)[0];
        if (alt) day.alternative = { type: alt.type, ...reasonsOf(alt) };
      }
    } else if (!fx.length) {
      const all = ranked();
      const ok = all.filter((x) => !x.blocks.length);
      const pick = best.items.find((x) => x.n === d && x.virtual);
      const chosen = ok.find((x) => pick && x.type === pick.type) || ok[0];
      if (chosen) {
        const r = reasonsOf(chosen);
        if (chosen.type === 'rest' && !r.reasons.length) r.reasons.push('Niente di urgente: il recupero fa parte del piano');
        day.suggestion = { type: chosen.type, from: chosen.from, score: chosen.score, ...r };
      }
      day.alternatives = ok.filter((x) => x !== chosen).slice(0, 3).map((x) => ({ type: x.type, ...reasonsOf(x) }));
      day.blocked = all.filter((x) => x.blocks.length && x.type !== 'rest').map((x) => ({ type: x.type, why: x.blocks[0] }));
    }
    days.push(day);
  }
  return { days, acwr: ctx.acwr, returning: ctx.returning };
}
