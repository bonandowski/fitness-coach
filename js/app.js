import { TYPES, GROUPS } from './catalog.js';
import { plan, toN, toS, weekday, localToday, DEFAULT_SETTINGS } from './engine.js';
import { computeStats } from './stats.js';
import * as store from './store.js';

let state = store.load();
let view = 'plan';
let showPast = false;
let persisted = null;

const $ = (s, el = document) => el.querySelector(s);
const T = (t) => TYPES[t] || TYPES.other;
const G = (t) => `g-${T(t).group}`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const settings = () => ({ ...DEFAULT_SETTINGS, ...state.settings });
const today = () => localToday();

const fmt = (date, opts) => new Intl.DateTimeFormat('it-IT', { timeZone: 'UTC', ...opts }).format(new Date(toN(date) * 864e5));
const wdShort = (date) => fmt(date, { weekday: 'short' }).replace('.', '');
const dayLong = (date) => fmt(date, { weekday: 'long', day: 'numeric', month: 'long' });
const relName = (date) => {
  const g = toN(date) - toN(today());
  if (g === 0) return 'oggi';
  if (g === 1) return 'domani';
  if (g === -1) return 'ieri';
  return dayLong(date);
};

// Fatica: 4 livelli comprensibili al posto della scala RPE 1-10.
const LEVELS = [['Facile', 3], ['Media', 6], ['Dura', 8], ['Al limite', 9]];
const levelName = (rpe) => (!rpe ? '' : rpe <= 4 ? 'facile' : rpe <= 6 ? 'media' : rpe <= 8 ? 'dura' : 'al limite');
const DURS = [20, 30, 45, 60, 90, 120];

const entriesOn = (date) => state.entries.filter((e) => e.date === date && e.status !== 'skipped');
const entryMeta = (e) => {
  if (e.type === 'rest') return '';
  return [e.dur ? `${e.dur}'` : '', e.status === 'done' ? levelName(e.rpe) : ''].filter(Boolean).join(', ');
};
const backupDue = () => {
  const last = state.meta.lastExport ? toN(state.meta.lastExport.slice(0, 10)) : null;
  return state.entries.length >= 5 && (!last || toN(today()) - last > 14);
};

function newEntry(date, type, status) {
  const t = T(type);
  return {
    id: store.uid(), date, type, status,
    dur: type === 'rest' ? 0 : t.dur,
    rpe: status === 'done' && type !== 'rest' ? t.rpe : undefined,
  };
}

function commit(msg, undo) {
  store.save(state);
  render();
  if (msg) toast(msg, undo);
}

function snapshot() {
  const copy = JSON.stringify(state);
  return () => { state = JSON.parse(copy); commit('Annullato'); };
}

// Un solo piano per giorno: scegliere un'opzione sostituisce quanto pianificato.
function setPlan(date, type) {
  state.entries = state.entries.filter((e) => !(e.date === date && e.status === 'planned'));
  if (type !== 'rest' || date !== today()) state.entries.push(newEntry(date, type, 'planned'));
}

// ---------- Piano ----------

function renderPlan() {
  const t = today();
  const P = plan(state, t);
  const [td, ...future] = P.days;
  let html = '';

  // Attività pianificate nei giorni scorsi e mai confermate.
  const pending = state.entries
    .filter((e) => e.status === 'planned' && e.date < t && e.date >= toS(toN(t) - 7))
    .sort((a, b) => b.date.localeCompare(a.date));
  for (const e of pending) {
    html += `<div class="confirm ${G(e.type)}"><div class="t">${esc(relName(e.date)).replace(/^./, (c) => c.toUpperCase())}: <strong>${esc(T(e.type).label.toLowerCase())}</strong>. L'hai fatta?</div>
      <button class="btn small" data-action="confirm-yes" data-id="${e.id}">Sì</button>
      <button class="btn small" data-action="confirm-no" data-id="${e.id}">No</button></div>`;
  }

  html += renderToday(td, P);

  html += `<h2 class="sec">Prossimi giorni</h2><div class="days">${future.slice(0, 7).map(futureRow).join('')}</div>`;

  html += `<button class="toggle" data-action="toggle-past">${showPast ? 'Nascondi ultimi giorni' : 'Mostra ultimi giorni'}</button>`;
  if (showPast) {
    const past = [];
    for (let k = 1; k <= 14; k++) past.push(toS(toN(t) - k));
    html += `<div class="days">${past.map(pastRow).join('')}</div>`;
  }
  return html;
}

function dateCell(date) {
  return `<div class="date"><span class="wd">${wdShort(date)}</span><span class="dn">${+date.slice(8)}</span></div>`;
}

function futureRow(d) {
  const es = entriesOn(d.date);
  let name = '';
  let sub = '';
  let cls = '';
  if (d.ghost) {
    cls = 'sugg g-calcetto';
    name = `<span class="dot"></span>Calcetto <span class="tag">probabile</span>`;
    sub = 'Tocca se non giochi';
  } else if (es.length) {
    cls = G(es[0].type);
    name = es.map((e) => `<span class="dot ${G(e.type)}"></span>${esc(T(e.type).label)}`).join(' ');
    const w = Object.values(d.warnings)[0];
    if (w) { name += ` <span class="tag w">da rivedere</span>`; sub = w[0]; } else sub = 'In programma';
  } else if (d.suggestion) {
    const s = d.suggestion;
    cls = `sugg ${G(s.type)}`;
    name = `<span class="dot"></span>${esc(T(s.type).label)}`;
    sub = s.reasons[0] || '';
  }
  return `<button class="row ${cls}" data-action="day" data-date="${d.date}">${dateCell(d.date)}
    <div class="body"><div class="name">${name}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div><span class="chev">›</span></button>`;
}

function pastRow(date) {
  const es = entriesOn(date).filter((e) => e.status === 'done');
  if (!es.length) {
    return `<button class="row empty" data-action="day" data-date="${date}">${dateCell(date)}<div class="body"><div class="name">Riposo</div></div></button>`;
  }
  return `<button class="row ${G(es[0].type)}" data-action="day" data-date="${date}">${dateCell(date)}<div class="body">
    <div class="name">${es.map((e) => `<span class="dot ${G(e.type)}"></span>${esc(T(e.type).label)}`).join(' ')}</div>
    <div class="sub">${esc(es.map(entryMeta).filter(Boolean).join(' · '))}</div></div></button>`;
}

function feelPills(t) {
  const c = state.checkins[t] || {};
  const pills = [
    ['legs-hard', 'Gambe dure', c.legs === 'hard'],
    ['legs-pain', 'Dolore gambe', c.legs === 'pain'],
    ['stiff', 'Rigido', !!c.stiff],
    ['tired', 'Stanco', c.energy === 'low'],
    ['groin', 'Fastidio inguine', state.flags.pain],
  ];
  return `<div class="feel"><p>Come stai?</p><div class="pills">${pills.map(([k, l, on]) =>
    `<button class="pill ${on ? 'on' : ''} ${on && (k === 'legs-pain' || k === 'groin') ? 'alert' : ''}" data-action="feel" data-k="${k}" aria-pressed="${on}">${l}</button>`).join('')}</div>
    ${state.flags.pain ? '<p class="hint" style="margin-top:8px">Il fastidio resta attivo anche nei prossimi giorni finché non lo togli.</p>' : ''}</div>`;
}

function whyBlock(s, blocked) {
  const more = [...(s.reasons || []).slice(1), ...(s.cautions || [])];
  const no = (blocked || []).slice(0, 4);
  const first = s.reasons?.[0] || s.cautions?.[0];
  let html = first ? `<p class="why">${esc(first)}</p>` : '';
  if (more.length || no.length) {
    html += `<details class="more"><summary>Perché questo</summary><ul>
      ${more.map((x) => `<li>${esc(x)}</li>`).join('')}
      ${no.map((b) => `<li class="no">Non ${esc(T(b.type).label.toLowerCase())}: ${esc(b.why.charAt(0).toLowerCase() + b.why.slice(1))}</li>`).join('')}
    </ul></details>`;
  }
  return html;
}

function renderToday(d, P) {
  const t = d.date;
  const es = entriesOn(t);
  const done = es.filter((e) => e.status === 'done');
  const planned = es.filter((e) => e.status === 'planned');
  let g = 'g-rest';
  let body = '';

  if (done.length) {
    const last = done[done.length - 1];
    g = G(last.type);
    body += `<div class="when">Oggi, fatto</div><h3>${esc(done.map((e) => T(e.type).label).join(' + '))}</h3>`;
    if (!last.rated && last.type !== 'rest') {
      body += `<div class="ask"><p>Com'è andata?</p><div class="pills">${LEVELS.map(([l, r]) =>
        `<button class="pill" data-action="rate" data-id="${last.id}" data-v="${r}">${l}</button>`).join('')}</div></div>`;
    } else {
      body += `<p class="guide">${esc(done.map(entryMeta).filter(Boolean).join(' · ') || 'Registrato')}.</p>`;
    }
    const tm = P.days[1];
    const next = tm?.ghost ? 'calcetto (probabile)' : tm?.suggestion ? T(tm.suggestion.type).label.toLowerCase() : null;
    if (next) body += `<p class="why">Domani: <strong>${esc(next)}</strong>${tm.suggestion?.reasons?.[0] ? `. ${esc(tm.suggestion.reasons[0])}` : ''}</p>`;
    body += `<div class="actions"><button class="btn ghost" data-action="log" data-date="${t}">Registra altro</button></div>`;
  } else if (d.ghost) {
    g = 'g-calcetto';
    body += `<div class="when">Oggi, probabile</div><h3>Calcetto</h3>
      <p class="guide">Di solito oggi giochi. Niente altro allenamento.</p>
      <div class="actions"><button class="btn primary" data-action="ghost-done" data-date="${t}">Ho giocato</button>
      <button class="btn ghost" data-action="no-calcetto" data-date="${t}">Non gioco</button></div>`;
  } else if (planned.length) {
    const e = planned[0];
    g = G(e.type);
    const warn = d.warnings[e.id];
    body += `<div class="when">Oggi, in programma</div><h3>${esc(T(e.type).label)}</h3>
      <p class="guide">${esc(e.note || T(e.type).guide)}</p>`;
    if (warn) {
      body += `<p class="warn">${esc(warn[0])}.${d.alternative ? ` Meglio ${esc(T(d.alternative.type).label.toLowerCase())}.` : ''}</p>`;
    }
    body += `<div class="actions"><button class="btn primary" data-action="mark-done" data-id="${e.id}">Fatto</button>`;
    body += warn && d.alternative
      ? `<button class="btn ghost" data-action="pick" data-date="${t}" data-type="${d.alternative.type}">Passa a ${esc(T(d.alternative.type).label.toLowerCase())}</button>`
      : `<button class="btn ghost" data-action="day" data-date="${t}">Cambia</button>`;
    body += `</div>`;
  } else if (d.suggestion) {
    const s = d.suggestion;
    g = G(s.type);
    body += `<div class="when">Oggi</div><h3>${esc(T(s.type).label)}</h3>`;
    if (s.type !== 'rest') body += `<p class="guide">${esc(T(s.type).guide)}</p>`;
    body += whyBlock(s, d.blocked);
    body += s.type === 'rest'
      ? `<div class="actions"><button class="btn ghost" data-action="day" data-date="${t}">Voglio allenarmi</button></div>`
      : `<div class="actions"><button class="btn primary" data-action="do-today" data-type="${s.type}">Fatto</button>
         <button class="btn ghost" data-action="day" data-date="${t}">Cambia</button></div>`;
  }

  return `<section class="today ${g}${done.length ? ' done' : ''}">${body}${done.length ? '' : feelPills(t)}</section>`;
}

// ---------- Sheet ----------

function openSheet(html) {
  $('.sheet-panel').innerHTML = html;
  $('#sheet').hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeSheet() {
  $('#sheet').hidden = true;
  document.body.style.overflow = '';
}

// Foglio di un giorno: cosa c'è, opzioni consigliate, registra altro.
function daySheet(date) {
  const t = today();
  const P = plan(state, t);
  const d = P.days.find((x) => x.date === date);
  const es = entriesOn(date);
  const isFuture = date > t;
  let html = `<h2>${esc(relName(date) === dayLong(date) ? dayLong(date) : `${relName(date)}, ${fmt(date, { day: 'numeric', month: 'long' })}`)}</h2>`;

  if (es.length) {
    html += `<span class="lab">${date < t || es.every((e) => e.status === 'done') ? 'Fatto' : 'In programma'}</span><div class="opts">`;
    for (const e of es) {
      const w = d?.warnings?.[e.id];
      html += `<div class="opt ${G(e.type)}"><span class="dot"></span>
        <button class="tx linkless" data-action="edit" data-id="${e.id}" style="border:0;background:none;text-align:left;padding:0">
          <b>${esc(T(e.type).label)}</b><small>${esc(w ? w[0] : [entryMeta(e), e.note].filter(Boolean).join(' · ') || (e.status === 'done' ? 'Fatto' : 'In programma'))}</small></button>
        <div class="side">${e.status === 'planned' && date <= t ? `<button class="btn small" data-action="mark-done" data-id="${e.id}">Fatto</button>` : ''}
          <button class="btn small" data-action="remove" data-id="${e.id}" aria-label="Rimuovi">Rimuovi</button></div></div>`;
    }
    html += `</div>`;
  }

  if (d?.ghost) {
    html += `<span class="lab">Calcetto probabile</span><div class="actions">
      <button class="btn primary" data-action="${date === t ? 'ghost-done' : 'ghost-confirm'}" data-date="${date}">${date === t ? 'Ho giocato' : 'Gioco'}</button>
      <button class="btn" data-action="no-calcetto" data-date="${date}">Non gioco</button></div>`;
  }

  // Opzioni consigliate (oggi e futuro, se il giorno non è già fatto).
  const hasDone = es.some((e) => e.status === 'done');
  if (d && !d.ghost && !hasDone) {
    const opts = d.suggestion ? [d.suggestion, ...(d.alternatives || [])] : d.alternative ? [d.alternative] : [];
    const cur = es.find((e) => e.status === 'planned')?.type;
    if (opts.length) {
      html += `<span class="lab">${es.length ? 'Alternative consigliate' : 'Cosa puoi fare'}</span><div class="opts">`;
      opts.forEach((s, i) => {
        html += `<button class="opt ${G(s.type)} ${cur === s.type ? 'cur' : ''}" data-action="pick" data-date="${date}" data-type="${s.type}">
          <span class="dot"></span><span class="tx"><b>${esc(T(s.type).label)}</b>${s.reasons?.[0] ? `<small>${esc(s.reasons[0])}</small>` : ''}</span>
          ${i === 0 && d.suggestion ? '<span class="best">Consigliato</span>' : ''}</button>`;
      });
      html += `</div>`;
    }
  }

  html += `<div class="actions" style="margin-top:14px"><button class="btn block" data-action="log" data-date="${date}">${isFuture ? 'Pianifica un\'altra attività' : 'Registra un\'altra attività'}</button></div>`;
  openSheet(html);
}

const TYPE_ORDER = ['legs_heavy', 'pull', 'push', 'legs_light', 'calcetto', 'calisthenics',
  'hills_short', 'hills_long', 'run_strides', 'run_steady', 'run_easy', 'beach', 'hike', 'mobility', 'other'];

let draft = null;
let draftIsNew = false;

// Registrazione rapida: tipo, com'è andata, durata. Lo stato dipende dal giorno.
function logSheet(entry, isNew) {
  draft = { ...entry };
  draftIsNew = isNew;
  const past = draft.date <= today();
  const title = isNew ? (past ? 'Registra attività' : 'Pianifica attività') : T(draft.type).label;
  const html = `<h2>${esc(title)}</h2>
    <div class="hint" style="margin:-8px 2px 4px">${esc(relName(draft.date))} · <button class="linkbtn" data-action="d-date">cambia giorno</button></div>
    <input class="input" type="date" name="date" value="${draft.date}" hidden>
    <span class="lab">Attività</span>
    <div class="types">${TYPE_ORDER.map((k) =>
      `<button class="${G(k)} ${draft.type === k ? 'on' : ''}" data-action="d-type" data-type="${k}"><span class="dot"></span>${esc(T(k).label)}</button>`).join('')}</div>
    <div id="f-level"><span class="lab">Com'è andata?</span><div class="pills">${LEVELS.map(([l, r]) =>
      `<button class="pill ${draft.rpe && levelName(draft.rpe) === levelName(r) ? 'on' : ''}" data-action="d-rpe" data-v="${r}">${l}</button>`).join('')}</div></div>
    <div id="f-dur"><span class="lab">Durata (minuti)</span><div class="dur">${DURS.map((m) =>
      `<button class="pill ${draft.dur === m ? 'on' : ''}" data-action="d-dur" data-v="${m}">${m}</button>`).join('')}
      <input class="input" type="number" inputmode="numeric" name="dur" value="${DURS.includes(draft.dur) ? '' : draft.dur ?? ''}" placeholder="altro" min="0"></div></div>
    <div style="margin-top:12px">${draft.note
      ? `<textarea class="input" name="note" rows="2">${esc(draft.note)}</textarea>`
      : `<button class="linkbtn" data-action="d-note">Aggiungi una nota</button><textarea class="input" name="note" rows="2" hidden placeholder="Es. quadricipiti duri"></textarea>`}</div>
    <div class="actions" style="margin-top:18px"><button class="btn primary" data-action="d-save">Salva</button>
      ${isNew ? '' : `<button class="btn danger" data-action="remove" data-id="${draft.id}">Elimina</button>`}</div>`;
  openSheet(html);
  syncLog();
}
function syncLog() {
  const past = draft.date <= today();
  $('#f-level').hidden = draft.type === 'rest' || !(past || draft.status === 'done');
  $('#f-dur').hidden = draft.type === 'rest';
}

// ---------- Statistiche ----------

const GROUP_ORDER = ['legs', 'pull', 'push', 'run', 'calcetto', 'other'];

function renderStats() {
  const S = computeStats(state, today());
  const wkLabel = (s) => fmt(s, { day: 'numeric', month: 'short' }).replace('.', '');
  let html = '';

  html += `<h2 class="sec" style="margin-top:4px">Questa settimana</h2><div class="card"><div class="bal">`;
  for (const b of S.balance.filter((x) => x.slot !== 'quality')) {
    const tot = Math.max(b.target, b.done + b.planned);
    const ok = b.done >= b.target;
    html += `<div class="bal-row"><span>${esc(b.label)}</span><div class="track">
      ${b.done ? `<i style="width:${(Math.min(b.done, tot) / tot) * 100}%"></i>` : ''}
      ${b.planned ? `<i class="pl" style="width:${(Math.min(b.planned, tot - Math.min(b.done, tot)) / tot) * 100}%"></i>` : ''}
      </div><span class="n ${ok ? 'ok' : ''}">${+b.done.toFixed(1)}/${b.target}</span></div>`;
  }
  html += `</div><div class="legend"><span><i style="--g:var(--ink)"></i>Fatto</span><span><i style="--g:var(--ink-3);opacity:.45"></i>In programma</span></div></div>`;

  let status = { s: 'var(--ink-3)', t: 'Servono 3 settimane di dati' };
  if (S.acwr !== null) {
    if (S.acwr > 1.5) status = { s: 'var(--bad)', t: 'Troppo, rischio infortunio' };
    else if (S.acwr > 1.3) status = { s: 'var(--warn)', t: 'In forte crescita' };
    else if (S.acwr >= 0.8) status = { s: 'var(--good)', t: 'Equilibrato' };
    else status = { s: 'var(--ink-3)', t: 'Settimana leggera' };
  }
  html += `<h2 class="sec">Carico</h2><div class="card">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
      <div><h4>Questa settimana rispetto al tuo solito</h4><p class="sub">Minuti per fatica. Bene tra 0,8 e 1,3.</p></div>
      <div class="big">${S.acwr === null ? '–' : S.acwr.toFixed(1).replace('.', ',')}</div>
    </div>
    <span class="status" style="--s:${status.s}">${status.t}</span>
    ${barChart(S.weekly.map((w) => ({ label: wkLabel(w.start), value: w.load, current: w.current, tip: `Settimana del ${wkLabel(w.start)}\nCarico ${w.load}\n${w.days} giorni di allenamento` })))}
  </div>`;

  html += `<h2 class="sec">Sedute per settimana</h2><div class="card">
    ${stackChart(S.weekly, wkLabel)}
    <div class="legend">${GROUP_ORDER.map((g) => `<span><i style="--g:${GROUPS[g].color}"></i>${GROUPS[g].label}</span>`).join('')}</div>
    <details class="tbl"><summary>Vedi i numeri</summary><table class="data"><tr><th>Settimana</th>${GROUP_ORDER.map((g) => `<th>${GROUPS[g].label}</th>`).join('')}</tr>
    ${S.weekly.map((w) => `<tr><td>${wkLabel(w.start)}</td>${GROUP_ORDER.map((g) => `<td>${w.groups[g] || 0}</td>`).join('')}</tr>`).join('')}</table></details>
  </div>`;

  const L = S.last30;
  const ratio = L.push ? (L.pull / L.push).toFixed(1).replace('.', ',') : '–';
  html += `<h2 class="sec">Ultimi 30 giorni</h2><div class="card"><div class="tiles">
    <div class="tile"><div class="v">${L.sessions}</div><div class="k">sedute</div></div>
    <div class="tile"><div class="v">${L.days}</div><div class="k">giorni attivi</div></div>
    <div class="tile"><div class="v">${Math.round(L.minutes / 60)}h</div><div class="k">di allenamento</div></div>
    <div class="tile"><div class="v">${ratio}</div><div class="k">tirata per ogni spinta (meglio 1 o più)</div></div>
  </div>
  ${L.byType.length ? `<div class="chips">${L.byType.map(([t, n]) => `<span class="chip ${G(t)}"><span class="dot"></span>${esc(T(t).label)} <span class="n">${n}</span></span>`).join('')}</div>` : ''}
  </div>`;
  return html;
}

function barChart(data) {
  const W = 320, H = 110, pad = 18, bw = (W - 8) / data.length;
  const max = Math.max(1, ...data.map((d) => d.value));
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H + pad}" role="img" aria-label="Carico settimanale">`;
  svg += `<line class="grid" x1="0" x2="${W}" y1="${H}" y2="${H}"/>`;
  data.forEach((d, i) => {
    const h = (d.value / max) * (H - 10);
    const x = 4 + i * bw;
    svg += `<g class="col" data-tip="${esc(d.tip)}"><rect class="hit" x="${x}" y="0" width="${bw}" height="${H + pad}" rx="6"/>`;
    if (h > 0) svg += `<path d="${roundTop(x + bw * 0.2, H, bw * 0.6, h)}" fill="${d.current ? 'var(--ink)' : 'var(--c-legs)'}"/>`;
    svg += `<text x="${x + bw / 2}" y="${H + 13}" text-anchor="middle">${esc(d.label)}</text></g>`;
  });
  return svg + `</svg>`;
}

function stackChart(weekly, wkLabel) {
  const W = 320, H = 110, pad = 18, bw = (W - 8) / weekly.length;
  const max = Math.max(4, ...weekly.map((w) => Object.values(w.groups).reduce((a, b) => a + b, 0)));
  const unit = (H - 10) / max;
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H + pad}" role="img" aria-label="Sedute per settimana per tipo">`;
  for (let k = 2; k <= max; k += 2) svg += `<line class="grid" x1="0" x2="${W}" y1="${H - k * unit}" y2="${H - k * unit}" stroke-dasharray="2 3"/><text x="${W}" y="${H - k * unit - 3}" text-anchor="end">${k}</text>`;
  svg += `<line class="grid" x1="0" x2="${W}" y1="${H}" y2="${H}"/>`;
  weekly.forEach((w, i) => {
    const x = 4 + i * bw;
    const tip = [`Settimana del ${wkLabel(w.start)}`, ...GROUP_ORDER.filter((g) => w.groups[g]).map((g) => `${GROUPS[g].label}: ${w.groups[g]}`)].join('\n');
    svg += `<g class="col" data-tip="${esc(tip)}"><rect class="hit" x="${x}" y="0" width="${bw}" height="${H + pad}" rx="6"/>`;
    let y = H;
    const present = GROUP_ORDER.filter((g) => w.groups[g]);
    present.forEach((g, j) => {
      const h = w.groups[g] * unit;
      const gap = j === 0 ? 0 : 2;
      svg += j === present.length - 1
        ? `<path d="${roundTop(x + bw * 0.2, y - gap, bw * 0.6, h - gap)}" fill="${GROUPS[g].color}"/>`
        : `<rect x="${x + bw * 0.2}" y="${y - h}" width="${bw * 0.6}" height="${h - gap}" fill="${GROUPS[g].color}"/>`;
      y -= h;
    });
    svg += `<text x="${x + bw / 2}" y="${H + 13}" text-anchor="middle">${esc(wkLabel(w.start))}</text></g>`;
  });
  return svg + `</svg>`;
}

function roundTop(x, base, w, h) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${base} V${base - h + r} Q${x},${base - h} ${x + r},${base - h} H${x + w - r} Q${x + w},${base - h} ${x + w},${base - h + r} V${base} Z`;
}

// ---------- Impostazioni ----------

function renderSettings() {
  const s = settings();
  const names = ['D', 'L', 'M', 'M', 'G', 'V', 'S'];
  const order = [1, 2, 3, 4, 5, 6, 0];
  const due = backupDue();
  let html = `<h2 class="sec" style="margin-top:4px">La tua settimana</h2><div class="card">
    <div class="set-row"><div class="t">Giorni di allenamento<small>Calcetto incluso</small></div>
      <div class="seg">${[['3.5', '3-4'], ['4.5', '4-5'], ['5.5', '5-6']].map(([v, l]) =>
        `<button class="${String(s.weeklyTarget) === v ? 'on' : ''}" data-action="set-wt" data-v="${v}">${l}</button>`).join('')}</div></div>
    <div class="set-row"><div class="t">Di solito riposo</div><div class="daypick">${order.map((d) =>
      `<button class="${s.restDays.includes(d) ? 'on' : ''}" data-action="set-rest" data-v="${d}" aria-pressed="${s.restDays.includes(d)}">${names[d]}</button>`).join('')}</div></div>
    <div class="set-row"><div class="t">Calcetto quasi fisso<small>Se non dici nulla, il piano lo dà per probabile</small></div>
      <button class="switch ${s.assumeCalcetto ? 'on' : ''}" data-action="set-assume" aria-pressed="${s.assumeCalcetto}" aria-label="Calcetto quasi fisso"></button></div>
    ${s.assumeCalcetto ? `<div class="set-row"><div class="t">Giorno del calcetto</div><div class="daypick">${order.map((d) =>
      `<button class="${s.calcettoDay === d ? 'on' : ''}" data-action="set-cday" data-v="${d}">${names[d]}</button>`).join('')}</div></div>` : ''}
  </div>`;

  html += `<h2 class="sec">Backup</h2><div class="card prose">
    <p>${due ? '<strong style="color:var(--warn)">È ora di fare un backup.</strong> ' : ''}I dati restano solo su questo telefono. Salva un backup ogni tanto: se cambi telefono o cancelli i dati del browser, lo reimporti da qui.</p>
    <p>Su iPhone usa l'app dall'icona sulla schermata Home, non da Safari.</p>
    <div class="actions" style="margin-top:10px">
      <button class="btn small ${due ? 'primary' : ''}" data-action="export" style="flex:none">Salva backup</button>
      <label class="btn small" style="display:inline-flex;align-items:center">Importa backup<input type="file" accept="application/json,.json" data-action="import" hidden></label>
    </div>
    <p class="hint">${state.meta.lastExport ? `Ultimo backup il ${new Date(state.meta.lastExport).toLocaleDateString('it-IT')}` : 'Nessun backup finora'}, ${state.entries.length} attività salvate${persisted === true ? ', archiviazione protetta' : ''}.</p>
  </div>`;

  html += `<h2 class="sec">Come decide il coach</h2><div class="card prose">
    <p>Scarta ciò che non rispetta i tempi di recupero, rispetto a quello che hai fatto e a quello che hai in programma, calcetto compreso, e ciò che non va bene con come stai oggi.</p>
    <p>Tra il resto sceglie ciò che manca di più nella settimana (gambe, tirata, spinta, corsa), alternando sedute dure e leggere, e guardando i prossimi 9 giorni insieme invece di un giorno alla volta.</p>
  </div>`;

  html += `<div style="text-align:center;margin:18px 0;display:flex;gap:8px;justify-content:center">
    ${state.entries.length === 0 ? `<button class="btn small" data-action="demo">Prova con dati di esempio</button>` : ''}
    <button class="btn small danger" data-action="reset">Cancella tutti i dati</button></div>`;
  return html;
}

// ---------- Render ----------

function render() {
  $('#top-date').textContent = dayLong(today());
  document.querySelectorAll('.tabs button').forEach((b) => {
    b.classList.toggle('on', b.dataset.view === view);
    if (b.dataset.view === 'settings') b.classList.toggle('dot', backupDue() && view !== 'settings');
  });
  $('.fab').hidden = view !== 'plan';
  $('#view').innerHTML = view === 'plan' ? renderPlan() : view === 'stats' ? renderStats() : renderSettings();
}

let toastTimer;
let undoFn = null;
function toast(msg, undo) {
  const el = $('#toast');
  undoFn = undo || null;
  el.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button data-action="undo">Annulla</button>' : ''}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; undoFn = null; }, 4000);
}

// ---------- Eventi ----------

document.addEventListener('click', async (ev) => {
  const tab = ev.target.closest('.tabs button');
  if (tab) { view = tab.dataset.view; render(); window.scrollTo(0, 0); return; }
  const el = ev.target.closest('[data-action]');
  if (!el || el.tagName === 'INPUT') return;
  const a = el.dataset.action;
  const { id, date, type } = el.dataset;
  const find = () => state.entries.find((x) => x.id === id);
  const t = today();

  switch (a) {
    case 'close': closeSheet(); break;
    case 'undo': if (undoFn) { const f = undoFn; undoFn = null; $('#toast').hidden = true; f(); } break;
    case 'toggle-past': showPast = !showPast; render(); break;
    case 'day': daySheet(date); break;
    case 'log': {
      const d = date || t;
      const sug = plan(state, t).days.find((x) => x.date === d)?.suggestion?.type;
      logSheet(newEntry(d, sug && sug !== 'rest' ? sug : 'pull', d <= t ? 'done' : 'planned'), true);
      break;
    }
    case 'edit': { const e = find(); if (e) logSheet(e, false); break; }

    case 'feel': {
      const c = { ...(state.checkins[t] || {}) };
      const k = el.dataset.k;
      if (k === 'legs-hard') c.legs = c.legs === 'hard' ? 'ok' : 'hard';
      if (k === 'legs-pain') c.legs = c.legs === 'pain' ? 'ok' : 'pain';
      if (k === 'stiff') c.stiff = !c.stiff;
      if (k === 'tired') c.energy = c.energy === 'low' ? 'ok' : 'low';
      if (k === 'groin') state.flags.pain = !state.flags.pain;
      state.checkins[t] = c;
      commit('Consiglio aggiornato');
      break;
    }

    case 'do-today': {
      const u = snapshot();
      state.entries = state.entries.filter((e) => !(e.date === t && e.status === 'planned'));
      state.entries.push(newEntry(t, type, 'done'));
      commit('Fatto', u);
      break;
    }
    case 'rate': { const e = find(); if (!e) break; e.rpe = +el.dataset.v; e.rated = true; commit(); break; }
    case 'mark-done': {
      const e = find(); if (!e) break;
      const u = snapshot();
      e.status = 'done';
      if (!e.rpe && e.type !== 'rest') e.rpe = T(e.type).rpe;
      closeSheet();
      commit('Fatto', u);
      break;
    }
    case 'confirm-yes': {
      const e = find(); if (!e) break;
      const u = snapshot();
      e.status = 'done'; e.rpe = e.rpe || T(e.type).rpe;
      commit('Segnato come fatto', u);
      break;
    }
    case 'confirm-no': { const e = find(); if (!e) break; const u = snapshot(); e.status = 'skipped'; commit('Segnato come saltato', u); break; }
    case 'remove': {
      const u = snapshot();
      state.entries = state.entries.filter((x) => x.id !== id);
      closeSheet();
      commit('Rimosso', u);
      break;
    }
    case 'pick': {
      const u = snapshot();
      setPlan(date, type);
      closeSheet();
      commit(date === t ? `Oggi: ${T(type).label.toLowerCase()}` : `${T(type).label} in programma ${relName(date)}`, u);
      break;
    }
    case 'ghost-confirm': case 'ghost-done': {
      const u = snapshot();
      state.entries.push(newEntry(date, 'calcetto', a === 'ghost-done' ? 'done' : 'planned'));
      closeSheet();
      commit(a === 'ghost-done' ? 'Calcetto registrato' : 'Calcetto in programma', u);
      break;
    }
    case 'no-calcetto': {
      const u = snapshot();
      const s = settings();
      state.settings = { ...state.settings, noCalcetto: [...s.noCalcetto.filter((x) => x >= toS(toN(t) - 30)), date] };
      closeSheet();
      commit('Niente calcetto, piano aggiornato', u);
      break;
    }

    // Registrazione
    case 'd-date': { const inp = $('[name=date]'); inp.hidden = false; inp.focus(); inp.showPicker?.(); break; }
    case 'd-note': { el.hidden = true; const n = $('[name=note]'); n.hidden = false; n.focus(); break; }
    case 'd-type': {
      const prev = draft.type;
      draft.type = type;
      if (!draft.dur || draft.dur === T(prev).dur) draft.dur = T(type).dur;
      el.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === el));
      document.querySelectorAll('#f-dur .pill').forEach((b) => b.classList.toggle('on', +b.dataset.v === draft.dur));
      $('[name=dur]').value = DURS.includes(draft.dur) ? '' : draft.dur ?? '';
      syncLog();
      break;
    }
    case 'd-rpe': draft.rpe = +el.dataset.v; draft.rated = true; el.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === el)); break;
    case 'd-dur': {
      draft.dur = +el.dataset.v;
      $('[name=dur]').value = '';
      el.parentElement.querySelectorAll('.pill').forEach((b) => b.classList.toggle('on', b === el));
      break;
    }
    case 'd-save': {
      const p = $('.sheet-panel');
      draft.date = $('[name=date]', p).value || draft.date;
      const custom = parseInt($('[name=dur]', p).value, 10);
      if (Number.isFinite(custom)) draft.dur = custom;
      draft.note = $('[name=note]', p).value.trim() || undefined;
      if (draftIsNew || draft.status !== 'skipped') {
        if (draftIsNew) draft.status = draft.date <= t ? 'done' : 'planned';
        else if (draft.date > t) draft.status = 'planned';
      }
      if (draft.status === 'done' && !draft.rpe && draft.type !== 'rest') draft.rpe = T(draft.type).rpe;
      if (draft.status !== 'done') delete draft.rpe;
      const u = snapshot();
      const i = state.entries.findIndex((x) => x.id === draft.id);
      if (i >= 0) state.entries[i] = draft; else state.entries.push(draft);
      closeSheet();
      commit(draft.status === 'done' ? 'Registrato' : `In programma ${relName(draft.date)}`, u);
      break;
    }

    // Impostazioni
    case 'set-assume': state.settings = { ...state.settings, assumeCalcetto: !settings().assumeCalcetto }; commit(); break;
    case 'set-cday': state.settings = { ...state.settings, calcettoDay: +el.dataset.v }; commit(); break;
    case 'set-rest': {
      const d = +el.dataset.v; const r = settings().restDays;
      state.settings = { ...state.settings, restDays: r.includes(d) ? r.filter((x) => x !== d) : [...r, d] };
      commit();
      break;
    }
    case 'set-wt': state.settings = { ...state.settings, weeklyTarget: +el.dataset.v }; commit(); break;
    case 'export': {
      if (await store.exportJSON(state)) { state.meta.lastExport = new Date().toISOString(); commit('Backup salvato'); }
      break;
    }
    case 'demo': state = demoState(); view = 'plan'; commit('Dati di esempio caricati'); break;
    case 'reset': {
      if (confirm('Cancellare tutti i dati? Salva prima un backup se vuoi tenerli.')) { const u = snapshot(); state = store.emptyState(); commit('Dati cancellati', u); }
      break;
    }
  }
});

document.addEventListener('change', async (ev) => {
  if (ev.target.name === 'date' && draft) { draft.date = ev.target.value || draft.date; syncLog(); return; }
  if (ev.target.dataset.action !== 'import') return;
  const file = ev.target.files[0];
  if (!file) return;
  try {
    const next = await store.importJSON(file);
    if (!confirm(`Importare ${next.entries.length} attività? I dati attuali verranno sostituiti.`)) return;
    const u = snapshot();
    state = next;
    commit('Backup importato', u);
  } catch {
    toast('Questo file non è un backup del coach');
  }
});

document.addEventListener('input', (ev) => {
  if (ev.target.name === 'dur' && ev.target.value) document.querySelectorAll('#f-dur .pill').forEach((b) => b.classList.remove('on'));
});

// Tooltip grafici (hover e tap)
const tip = $('#tip');
function showTip(g, x, y) {
  tip.textContent = g.dataset.tip;
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  tip.style.left = `${Math.min(window.innerWidth - r.width - 8, Math.max(8, x - r.width / 2))}px`;
  tip.style.top = `${Math.max(8, y - r.height - 12)}px`;
}
document.addEventListener('pointermove', (ev) => {
  const g = ev.target.closest?.('g.col');
  if (g) showTip(g, ev.clientX, ev.clientY); else if (ev.pointerType === 'mouse') tip.hidden = true;
});
document.addEventListener('pointerdown', (ev) => {
  const g = ev.target.closest?.('g.col');
  document.querySelectorAll('g.col.on').forEach((x) => x.classList.remove('on'));
  if (g) { g.classList.add('on'); showTip(g, ev.clientX, ev.clientY); } else tip.hidden = true;
});
window.addEventListener('scroll', () => { tip.hidden = true; }, { passive: true });
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeSheet(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && $('#sheet').hidden) { state = store.load(); render(); }
});

// ---------- Dati di esempio ----------

function demoState() {
  const s = store.emptyState();
  const t = toN(today());
  const add = (k, type, extra = {}) => s.entries.push({ ...newEntry(toS(t + k), type, k < 0 ? 'done' : 'planned'), rated: true, ...extra });
  const pattern = [
    [-27, 'legs_heavy'], [-26, 'pull'], [-24, 'hills_short'], [-23, 'push'], [-22, 'run_easy'], [-21, 'calcetto'],
    [-19, 'pull'], [-18, 'legs_heavy'], [-16, 'push'], [-15, 'run_strides'], [-14, 'calcetto'],
    [-12, 'push'], [-11, 'legs_heavy'], [-10, 'pull'], [-9, 'hills_long'], [-8, 'run_easy'], [-7, 'calcetto', { rpe: 9 }],
    [-6, 'mobility'], [-5, 'pull'], [-4, 'calisthenics'], [-3, 'hills_short'], [-2, 'hike', { dur: 200 }],
  ];
  for (const [k, type, extra] of pattern) add(k, type, extra);
  s.entries.push({ ...newEntry(toS(t - 1), 'push', 'planned') });
  return s;
}

// ---------- Avvio ----------

render();
store.persist().then((p) => { persisted = p; if (view === 'settings') render(); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
