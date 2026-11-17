import { TYPES, GROUPS } from './catalog.js';
import { plan, toN, toS, weekday, localToday, DEFAULT_SETTINGS } from './engine.js';
import { computeStats } from './stats.js';
import * as store from './store.js';

let state = store.load();
let view = 'plan';
let pastDays = 7;
let persisted = null;

const $ = (s, el = document) => el.querySelector(s);
const T = (t) => TYPES[t] || TYPES.other;
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

function commit(msg, undo) {
  store.save(state);
  render();
  if (msg) toast(msg, undo);
}

// ---------- Componenti ----------

const chip = (type, cls = '', meta = '', attrs = '') =>
  `<button class="chip g-${T(type).group} ${cls}" ${attrs}><span class="dot"></span>${esc(T(type).label)}${meta ? ` <span class="meta">${esc(meta)}</span>` : ''}</button>`;

const entryMeta = (e) => {
  if (e.type === 'rest') return '';
  const parts = [];
  if (e.dur) parts.push(`${e.dur}'`);
  if (e.status === 'done' && e.rpe) parts.push(`RPE ${e.rpe}`);
  return parts.join(' · ');
};

function entryChip(e, warn) {
  const past = e.date < today();
  let cls = e.status;
  if (e.status === 'planned' && past) cls += ' unconfirmed';
  if (warn) cls += ' warn';
  return chip(e.type, cls, entryMeta(e), `data-action="edit" data-id="${e.id}"`);
}

const entriesOn = (date) => state.entries.filter((e) => e.date === date);

function dateCell(date) {
  return `<div class="date"><span class="wd">${wdShort(date)}</span><span class="dn">${+date.slice(8)}</span></div>`;
}
const isWeekend = (date) => [0, 6].includes(weekday(toN(date)));

// ---------- Piano ----------

function renderPlan() {
  const t = today();
  const P = plan(state, t);
  const [td, ...future] = P.days;
  let html = '';

  // Passato
  const past = [];
  for (let k = pastDays; k >= 1; k--) past.push(toS(toN(t) - k));
  const unconfirmed = state.entries.filter((e) => e.status === 'planned' && e.date < t).length;
  html += `<h3 class="section">Ultimi giorni${unconfirmed ? ` · <span style="color:var(--warn)">${unconfirmed} da confermare</span>` : ''}</h3>`;
  html += `<div class="days">`;
  for (const d of past) {
    const es = entriesOn(d);
    const body = es.length ? es.map((e) => entryChip(e)).join('') : `<span class="muted">Riposo</span>`;
    html += `<div class="row ${isWeekend(d) ? 'weekend' : ''}" data-action="day" data-date="${d}">${dateCell(d)}<div class="body">${body}</div></div>`;
  }
  html += `</div><div style="text-align:center"><button class="link" data-action="more-past">Mostra ${pastDays >= 28 ? 'meno' : 'altri giorni'}</button></div>`;

  html += renderToday(td, P);

  // Futuro
  html += `<h3 class="section">Prossimi giorni</h3><div class="days">`;
  for (const d of future.slice(0, 7)) html += futureRow(d);
  html += `</div>`;
  html += `<p class="hint" style="text-align:center;margin:10px 0 0">I consigli si ricalcolano a ogni modifica. Tocca un giorno per pianificare o cambiare.</p>`;
  return html;
}

function futureRow(d) {
  const es = entriesOn(d.date);
  let body = '';
  if (d.ghost) {
    body = chip('calcetto', 'ghost', 'probabile', `data-action="day" data-date="${d.date}"`);
    body += `<span class="why">Se non giochi tocca e scegli "niente calcetto"</span>`;
  } else if (es.length) {
    body = es.map((e) => entryChip(e, d.warnings[e.id])).join('');
    const w = Object.values(d.warnings)[0];
    if (w) body += `<span class="why" style="color:var(--warn)">${esc(w[0])}</span>`;
  } else if (d.suggestion) {
    const s = d.suggestion;
    body = chip(s.type, 'sugg', s.type === 'rest' ? '' : `${T(s.type).dur}'`, `data-action="day" data-date="${d.date}"`);
    if (s.reasons[0]) body += `<span class="why">${esc(s.reasons[0])}</span>`;
  }
  return `<div class="row ${isWeekend(d.date) ? 'weekend' : ''}" data-action="day" data-date="${d.date}">${dateCell(d.date)}<div class="body">${body}</div></div>`;
}

function seg(name, options, value) {
  return `<div class="seg" role="group">${options.map(([v, label, bad]) =>
    `<button class="${value === v ? 'on' : ''} ${bad ? 'bad' : ''}" data-action="checkin" data-k="${name}" data-v="${v}">${label}</button>`).join('')}</div>`;
}

function reasonsList(r, extraBlocks = []) {
  const items = [
    ...extraBlocks.map((x) => `<li class="b">${esc(x)}</li>`),
    ...(r.reasons || []).map((x) => `<li>${esc(x)}</li>`),
    ...(r.cautions || []).map((x) => `<li class="c">${esc(x)}</li>`),
  ];
  return items.length ? `<ul class="reasons">${items.join('')}</ul>` : '';
}

function renderToday(d, P) {
  const t = d.date;
  const c = (state.checkins || {})[t] || {};
  const es = entriesOn(t);
  const done = es.filter((e) => e.status === 'done');
  const planned = es.filter((e) => e.status === 'planned');
  let html = `<section class="today"><div class="today-head"><h2>Oggi</h2><span>${dayLong(t)}</span></div>`;

  html += `<div class="checkin">
    <div class="ck"><label>Gambe</label>${seg('legs', [['ok', 'Sciolte'], ['hard', 'Indurite', 1], ['pain', 'Dolore', 1]], c.legs || 'ok')}</div>
    <div class="ck"><label>Rigidità</label>${seg('stiff', [['no', 'No'], ['yes', 'Sì', 1]], c.stiff ? 'yes' : 'no')}</div>
    <div class="ck"><label>Energia</label>${seg('energy', [['low', 'Bassa', 1], ['ok', 'Ok'], ['high', 'Alta']], c.energy || 'ok')}</div>
    <button class="pain ${state.flags.pain ? 'on' : ''}" data-action="pain"><span class="box">${state.flags.pain ? '✓' : ''}</span>
      <span>${state.flags.pain ? 'Fastidio che tira attivo: niente gambe pesanti, sprint e salite. Tocca quando passa.' : 'Fastidio che tira (inguine, adduttori, flessori)'}</span></button>
  </div>`;

  html += `<div class="rec">`;
  if (done.length) {
    html += `<div class="rec-kicker">Fatto oggi</div><div class="alts" style="margin-top:6px">${es.map((e) => entryChip(e)).join('')}</div>`;
    const tomorrow = P.days[1];
    if (tomorrow?.suggestion) {
      html += `<p class="guide" style="margin-top:12px">Domani: <strong>${esc(T(tomorrow.suggestion.type).label)}</strong>${tomorrow.suggestion.reasons[0] ? ` · ${esc(tomorrow.suggestion.reasons[0])}` : ''}</p>`;
    }
    html += `<div class="actions" style="margin-top:12px"><button class="btn small" data-action="add" data-date="${t}">+ Aggiungi</button></div>`;
  } else if (d.ghost) {
    html += `<div class="rec-kicker">Probabile</div>
      <div class="rec-title g-calcetto"><span class="bar"></span><h3>Calcetto</h3></div>
      <p class="guide">Oggi di solito giochi. Niente altro allenamento.</p>
      <div class="actions"><button class="btn primary" data-action="ghost-done" data-date="${t}">Ho giocato</button>
      <button class="btn" data-action="no-calcetto" data-date="${t}">Niente calcetto</button></div>`;
  } else if (planned.length) {
    const e = planned[0];
    const warn = d.warnings[e.id];
    html += `<div class="rec-kicker">In programma</div>
      <div class="rec-title g-${T(e.type).group}"><span class="bar"></span><h3>${esc(T(e.type).label)}</h3></div>
      <p class="guide">${esc(e.note || T(e.type).guide)}</p>`;
    if (warn) {
      html += `<div class="warnbox"><strong>Attenzione.</strong> ${warn.map(esc).join('. ')}.`;
      if (d.alternative) html += `<br>Meglio: <strong>${esc(T(d.alternative.type).label)}</strong>.`;
      html += `</div>`;
    }
    html += `<div class="actions"><button class="btn primary" data-action="mark-done" data-id="${e.id}">Fatto</button>`;
    if (warn && d.alternative) html += `<button class="btn" data-action="swap" data-id="${e.id}" data-type="${d.alternative.type}">Passa a ${esc(T(d.alternative.type).label.toLowerCase())}</button>`;
    html += `<button class="btn" data-action="edit" data-id="${e.id}">Modifica</button></div>`;
    if (planned.length > 1) html += `<div class="alts">${planned.slice(1).map((x) => entryChip(x)).join('')}</div>`;
  } else if (d.suggestion) {
    const s = d.suggestion;
    const g = T(s.type).group;
    html += `<div class="rec-kicker">Consigliato</div>
      <div class="rec-title g-${g}"><span class="bar"></span><h3>${esc(T(s.type).label)}</h3></div>
      <p class="guide">${esc(T(s.type).guide)}</p>
      ${reasonsList(s)}
      <div class="actions">
        ${s.type === 'rest'
          ? `<button class="btn primary" data-action="accept-done" data-date="${t}" data-type="rest">Ok, riposo</button>`
          : `<button class="btn primary" data-action="accept-done" data-date="${t}" data-type="${s.type}">Fatto</button>
             <button class="btn" data-action="accept" data-date="${t}" data-type="${s.type}">Lo faccio dopo</button>`}
        <button class="btn" data-action="add" data-date="${t}">Ho fatto altro</button>
      </div>`;
    if (d.alternatives?.length) {
      html += `<div class="alts"><span class="lab">Oppure</span>${d.alternatives.map((a) =>
        chip(a.type, 'sugg', '', `data-action="accept" data-date="${t}" data-type="${a.type}"`)).join('')}</div>`;
    }
    if (d.blocked?.length) {
      html += `<details class="whynot"><summary>Perché non altro</summary><ul>${d.blocked.map((b) =>
        `<li><strong>${esc(T(b.type).label)}</strong>: ${esc(b.why)}</li>`).join('')}</ul></details>`;
    }
  }
  html += `</div>`;

  if (P.returning) html += `<div class="banner">Nessun allenamento negli ultimi 10 giorni: i primi giorni il piano resta morbido.</div>`;
  const last = state.meta.lastExport ? toN(state.meta.lastExport.slice(0, 10)) : null;
  if (state.entries.length >= 5 && (!last || toN(t) - last > 14)) {
    html += `<div class="banner"><span>${last ? `Ultimo backup ${toN(t) - last} giorni fa.` : 'Non hai ancora fatto un backup.'}</span><button class="btn small" data-action="export">Backup</button></div>`;
  }
  html += `</section>`;
  return html;
}

// ---------- Sheet ----------

function openSheet(html) {
  const sh = $('#sheet');
  $('.sheet-panel', sh).innerHTML = html;
  sh.hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeSheet() {
  $('#sheet').hidden = true;
  document.body.style.overflow = '';
}

function daySheet(date) {
  const P = plan(state, today());
  const d = P.days.find((x) => x.date === date);
  const es = entriesOn(date);
  const isPast = date < today();
  let html = `<h2 class="cap">${dayLong(date)}</h2>`;
  if (es.length) {
    html += `<div class="field"><span class="lab">Attività</span><div class="entry-list">`;
    for (const e of es) {
      const w = d?.warnings?.[e.id];
      html += `<div class="sugg-card g-${T(e.type).group}"><div class="head"><strong><span class="dot"></span>${esc(T(e.type).label)}</strong>
        <span class="muted" style="font-size:12.5px">${e.status === 'done' ? 'Fatto' : e.status === 'skipped' ? 'Saltato' : 'Pianificato'}${entryMeta(e) ? ' · ' + esc(entryMeta(e)) : ''}</span></div>
        ${w ? `<p style="color:var(--warn)">${w.map(esc).join('. ')}</p>` : ''}
        ${e.note ? `<p>${esc(e.note)}</p>` : ''}
        <div class="actions" style="margin-top:10px">
          ${e.status !== 'done' ? `<button class="btn small primary" data-action="mark-done" data-id="${e.id}">Fatto</button>` : ''}
          ${e.status === 'planned' && isPast ? `<button class="btn small" data-action="mark-skip" data-id="${e.id}">Saltato</button>` : ''}
          <button class="btn small" data-action="edit" data-id="${e.id}">Modifica</button>
        </div></div>`;
    }
    html += `</div></div>`;
    if (d?.alternative) html += `<p class="hint">Alternativa consigliata: <strong>${esc(T(d.alternative.type).label)}</strong></p>`;
  }
  if (d?.ghost) {
    html += `<div class="sugg-card g-calcetto"><div class="head"><strong><span class="dot"></span>Calcetto probabile</strong></div>
      <p>Il piano dei giorni vicini lo tiene in conto. Se non giochi, i consigli si liberano.</p>
      <div class="actions" style="margin-top:10px">
        <button class="btn small primary" data-action="ghost-confirm" data-date="${date}">Confermo</button>
        <button class="btn small" data-action="no-calcetto" data-date="${date}">Niente calcetto</button>
      </div></div>`;
  }
  if (d && !es.length && !d.ghost && d.suggestion) {
    const opts = [d.suggestion, ...(d.alternatives || [])];
    html += `<div class="field"><span class="lab">Consigli per ${relName(date)}</span>`;
    opts.forEach((s, i) => {
      html += `<div class="sugg-card g-${T(s.type).group}"><div class="head"><strong><span class="dot"></span>${esc(T(s.type).label)}${i === 0 ? ' <span class="muted" style="font-weight:500;font-size:12px">migliore</span>' : ''}</strong>
        <button class="btn small ${i === 0 ? 'primary' : ''}" data-action="accept" data-date="${date}" data-type="${s.type}">Pianifica</button></div>
        <p>${esc(T(s.type).guide)}</p>${reasonsList(s)}</div>`;
    });
    if (d.blocked?.length) {
      html += `<details class="whynot"><summary>Perché non altro</summary><ul>${d.blocked.map((b) =>
        `<li><strong>${esc(T(b.type).label)}</strong>: ${esc(b.why)}</li>`).join('')}</ul></details>`;
    }
    html += `</div>`;
  }
  html += `<button class="btn block" data-action="add" data-date="${date}" style="margin-top:8px">+ Aggiungi attività</button>`;
  openSheet(html);
}

const TYPE_ORDER = ['legs_heavy', 'legs_light', 'pull', 'push', 'hills_short', 'hills_long', 'run_strides', 'run_steady',
  'run_easy', 'calcetto', 'calisthenics', 'beach', 'hike', 'mobility', 'rest', 'other'];

let draft = null;
function editorSheet(entry) {
  draft = entry ? { ...entry } : null;
  const e = draft;
  const html = `<h2>${entry.id && state.entries.some((x) => x.id === entry.id) ? 'Modifica' : 'Nuova attività'}</h2>
    <div class="field"><span class="lab">Giorno</span><input class="input" type="date" name="date" value="${e.date}"></div>
    <div class="field"><span class="lab">Attività</span><div class="typegrid">${TYPE_ORDER.map((k) =>
      `<button class="g-${T(k).group} ${e.type === k ? 'on' : ''}" data-action="d-type" data-type="${k}"><span class="dot"></span>${esc(T(k).label)}</button>`).join('')}</div>
      <p class="hint" id="d-guide">${esc(T(e.type).guide)}</p></div>
    <div class="field"><span class="lab">Stato</span>${seg('status', [['done', 'Fatto'], ['planned', 'Pianificato'], ['skipped', 'Saltato']], e.status).replaceAll('data-action="checkin"', 'data-action="d-status"')}</div>
    <div class="field" id="f-dur"><span class="lab">Durata (minuti)</span><div class="stepper">
      <button class="btn small" data-action="d-dur" data-v="-10">−10</button>
      <input class="input" type="number" inputmode="numeric" name="dur" value="${e.dur ?? ''}" min="0" step="5">
      <button class="btn small" data-action="d-dur" data-v="10">+10</button></div></div>
    <div class="field" id="f-rpe"><span class="lab">Fatica percepita (RPE)</span><div class="rpe">${Array.from({ length: 10 }, (_, i) =>
      `<button class="${e.rpe === i + 1 ? 'on' : ''}" data-action="d-rpe" data-v="${i + 1}">${i + 1}</button>`).join('')}</div>
      <p class="hint">1-3 facile · 4-6 moderato · 7-8 duro · 9-10 al limite. Calcetto con RPE 4 o meno conta come blando.</p></div>
    <div class="field"><span class="lab">Note</span><textarea class="input" name="note" rows="2" placeholder="Es. quadricipiti duri, ottima seduta…">${esc(e.note || '')}</textarea></div>
    <div class="actions"><button class="btn primary" data-action="d-save" style="flex:1">Salva</button>
      ${state.entries.some((x) => x.id === e.id) ? `<button class="btn danger" data-action="d-delete">Elimina</button>` : ''}</div>`;
  openSheet(html);
  syncEditor();
}
function syncEditor() {
  const rest = draft.type === 'rest';
  $('#f-dur').hidden = rest;
  $('#f-rpe').hidden = rest || draft.status !== 'done';
}
function readDraft() {
  const p = $('.sheet-panel');
  draft.date = $('[name=date]', p).value || draft.date;
  const dur = parseInt($('[name=dur]', p).value, 10);
  draft.dur = Number.isFinite(dur) ? dur : undefined;
  draft.note = $('[name=note]', p).value.trim() || undefined;
}

function newEntry(date, type, status) {
  const t = T(type);
  return { id: store.uid(), date, type, status, dur: type === 'rest' ? 0 : t.dur, rpe: status === 'done' && type !== 'rest' ? t.rpe : undefined };
}

// ---------- Statistiche ----------

const GROUP_ORDER = ['legs', 'pull', 'push', 'run', 'calcetto', 'other'];

function renderStats() {
  const S = computeStats(state, today());
  const wkLabel = (s) => fmt(s, { day: 'numeric', month: 'short' }).replace('.', '');
  let html = '';

  html += `<h3 class="section">Questa settimana</h3><div class="card"><div class="bal">`;
  for (const b of S.balance) {
    const tot = Math.max(b.target, b.done + b.planned);
    const ok = b.done >= b.target;
    html += `<div class="bal-row"><span>${esc(b.label)}</span><div class="track">
      ${b.done ? `<i style="width:${(Math.min(b.done, tot) / tot) * 100}%"></i>` : ''}
      ${b.planned ? `<i class="pl" style="width:${(Math.min(b.planned, tot - Math.min(b.done, tot)) / tot) * 100}%"></i>` : ''}
      </div><span class="n ${ok ? 'ok' : ''}">${+b.done.toFixed(1)}/${b.target}</span></div>`;
  }
  html += `</div><div class="legend" style="margin-top:12px"><span><i style="--g:var(--ink)"></i>Fatto</span><span><i style="--g:var(--ink-3);opacity:.45"></i>Pianificato</span>
    <span>Calcetto: ${S.calcetto}</span><span>Giorni senza allenamento: ${S.restDays}</span></div></div>`;

  // Carico
  let status = { s: 'var(--ink-3)', t: 'Servono 3 settimane di dati' };
  if (S.acwr !== null) {
    if (S.acwr > 1.5) status = { s: 'var(--bad)', t: 'Troppo, rischio infortunio' };
    else if (S.acwr > 1.3) status = { s: 'var(--warn)', t: 'In forte crescita' };
    else if (S.acwr >= 0.8) status = { s: 'var(--good)', t: 'Equilibrato' };
    else status = { s: 'var(--ink-3)', t: 'Scarico' };
  }
  html += `<h3 class="section">Carico</h3><div class="card">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
      <div><h4>Settimana vs media del mese</h4><p class="sub">Carico = minuti × fatica (RPE). Ideale tra 0,8 e 1,3.</p></div>
      <div style="text-align:right"><div style="font-size:26px;font-weight:750;letter-spacing:-.02em">${S.acwr === null ? '–' : S.acwr.toFixed(2).replace('.', ',')}</div></div>
    </div>
    <span class="status" style="--s:${status.s}">${status.t}</span>
    ${barChart(S.weekly.map((w) => ({ label: wkLabel(w.start), value: w.load, current: w.current, tip: `Settimana del ${wkLabel(w.start)}\nCarico ${w.load}\n${w.days} giorni di allenamento` })))}
  </div>`;

  // Sedute per gruppo
  html += `<h3 class="section">Sedute per settimana</h3><div class="card">
    ${stackChart(S.weekly, wkLabel)}
    <div class="legend">${GROUP_ORDER.map((g) => `<span><i style="--g:${GROUPS[g].color}"></i>${GROUPS[g].label}</span>`).join('')}</div>
    <details class="tbl"><summary>Vedi tabella</summary><table class="data"><tr><th>Settimana</th>${GROUP_ORDER.map((g) => `<th>${GROUPS[g].label}</th>`).join('')}</tr>
    ${S.weekly.map((w) => `<tr><td>${wkLabel(w.start)}</td>${GROUP_ORDER.map((g) => `<td>${w.groups[g] || 0}</td>`).join('')}</tr>`).join('')}</table></details>
  </div>`;

  // Ultimi 30 giorni
  const L = S.last30;
  const ratio = L.push ? (L.pull / L.push).toFixed(1).replace('.', ',') : '–';
  html += `<h3 class="section">Ultimi 30 giorni</h3><div class="card"><div class="tiles">
    <div class="tile"><div class="v">${L.sessions}</div><div class="k">sedute</div></div>
    <div class="tile"><div class="v">${L.days}</div><div class="k">giorni attivi</div></div>
    <div class="tile"><div class="v">${Math.round(L.minutes / 60)}h</div><div class="k">tempo totale</div></div>
    <div class="tile"><div class="v">${ratio}</div><div class="k">tirata : spinta (ideale ≥ 1)</div></div>
  </div>
  ${L.byType.length ? `<div class="alts" style="margin-top:12px">${L.byType.map(([t, n]) => chip(t, '', `×${n}`, 'tabindex="-1"')).join('')}</div>` : ''}
  </div>`;
  return html;
}

function barChart(data) {
  const W = 320, H = 120, pad = 18, bw = (W - 8) / data.length;
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
  const W = 320, H = 120, pad = 18, bw = (W - 8) / weekly.length;
  const max = Math.max(4, ...weekly.map((w) => Object.values(w.groups).reduce((a, b) => a + b, 0)));
  const unit = (H - 10) / max;
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H + pad}" role="img" aria-label="Sedute per settimana per tipo">`;
  for (let k = 1; k <= max; k++) if (k % 2 === 0) svg += `<line class="grid" x1="0" x2="${W}" y1="${H - k * unit}" y2="${H - k * unit}" stroke-dasharray="2 3"/><text x="${W}" y="${H - k * unit - 3}" text-anchor="end">${k}</text>`;
  svg += `<line class="grid" x1="0" x2="${W}" y1="${H}" y2="${H}"/>`;
  weekly.forEach((w, i) => {
    const x = 4 + i * bw;
    const tip = [`Settimana del ${wkLabel(w.start)}`, ...GROUP_ORDER.filter((g) => w.groups[g]).map((g) => `${GROUPS[g].label}: ${w.groups[g]}`)].join('\n');
    svg += `<g class="col" data-tip="${esc(tip)}"><rect class="hit" x="${x}" y="0" width="${bw}" height="${H + pad}" rx="6"/>`;
    let y = H;
    const present = GROUP_ORDER.filter((g) => w.groups[g]);
    present.forEach((g, j) => {
      const h = w.groups[g] * unit;
      const top = j === present.length - 1;
      const gap = j === 0 ? 0 : 2;
      svg += top
        ? `<path d="${roundTop(x + bw * 0.2, y - gap, bw * 0.6, h - gap)}" fill="${GROUPS[g].color}"/>`
        : `<rect x="${x + bw * 0.2}" y="${y - h}" width="${bw * 0.6}" height="${h - gap}" fill="${GROUPS[g].color}"/>`;
      y -= h;
    });
    svg += `<text x="${x + bw / 2}" y="${H + 13}" text-anchor="middle">${esc(wkLabel(w.start))}</text></g>`;
  });
  return svg + `</svg>`;
}

// Barra con angoli arrotondati solo in alto (base piatta sull'asse).
function roundTop(x, base, w, h) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${base} V${base - h + r} Q${x},${base - h} ${x + r},${base - h} H${x + w - r} Q${x + w},${base - h} ${x + w},${base - h + r} V${base} Z`;
}

// ---------- Impostazioni ----------

function renderSettings() {
  const s = settings();
  const names = ['D', 'L', 'M', 'M', 'G', 'V', 'S'];
  const order = [1, 2, 3, 4, 5, 6, 0];
  let html = `<h3 class="section">Calendario</h3><div class="card">
    <div class="set-row"><div class="t">Calcetto probabile<small>Se non segni nulla, lo considera nel piano</small></div>
      <button class="switch ${s.assumeCalcetto ? 'on' : ''}" data-action="set-assume" aria-label="Calcetto probabile"></button></div>
    <div class="set-row"><div class="t">Giorno del calcetto</div><div class="daypick">${order.map((d) =>
      `<button class="${s.calcettoDay === d ? 'on' : ''}" data-action="set-cday" data-v="${d}">${names[d]}</button>`).join('')}</div></div>
    <div class="set-row"><div class="t">Giorni preferiti di riposo</div><div class="daypick">${order.map((d) =>
      `<button class="${s.restDays.includes(d) ? 'on' : ''}" data-action="set-rest" data-v="${d}">${names[d]}</button>`).join('')}</div></div>
    <div class="set-row"><div class="t">Giorni di allenamento a settimana<small>Calcetto incluso</small></div>
      ${seg('wt', [['3.5', '3-4'], ['4.5', '4-5'], ['5.5', '5-6']], String(s.weeklyTarget)).replaceAll('data-action="checkin"', 'data-action="set-wt"')}</div>
  </div>`;

  html += `<h3 class="section">Dati e backup</h3><div class="card prose">
    <p>I dati restano solo su questo telefono, nel browser. ${persisted === true ? '<strong style="color:var(--good)">Archiviazione persistente attiva.</strong>' : ''}</p>
    <p><strong>iPhone:</strong> aggiungi l'app alla schermata Home (Condividi → Aggiungi a Home) e usala sempre da lì, altrimenti Safari può cancellare i dati dopo 7 giorni senza visite.</p>
    <div class="actions" style="margin-top:10px">
      <button class="btn small primary" data-action="export">Esporta backup</button>
      <label class="btn small" style="display:inline-flex;align-items:center">Importa<input type="file" accept="application/json,.json" data-action="import" hidden></label>
    </div>
    <p class="hint" style="margin-top:8px">${state.meta.lastExport ? `Ultimo backup: ${new Date(state.meta.lastExport).toLocaleDateString('it-IT')}` : 'Nessun backup ancora.'} · ${state.entries.length} attività registrate</p>
  </div>`;

  html += `<h3 class="section">Come ragiona il coach</h3><div class="card prose">
    <p>Ogni giorno valuta tutte le sedute possibili. Scarta quelle che violano le finestre di recupero rispetto a ciò che hai fatto e a ciò che hai già in programma (calcetto incluso), o i segnali del check-in.</p>
    <p>Alle altre dà un punteggio: quanto è in ritardo ogni obiettivo della settimana (1 gambe, 1 tirata, 1 spinta, 1-2 corse, 1 qualità), alternanza duro/facile e spinta/tirata, varietà nella corsa, giorni di fila, carico della settimana rispetto alla media del mese, giorni in cui preferisci riposare.</p>
    <p>Poi confronta molte combinazioni sui prossimi 9 giorni e sceglie la sequenza migliore nel complesso, così oggi non ti "brucia" la finestra utile per le gambe prima di una partita.</p>
  </div>`;

  html += `<div style="text-align:center;margin:18px 0">
    ${state.entries.length === 0 ? `<button class="btn small" data-action="demo">Carica dati di esempio</button>` : ''}
    <button class="btn small danger" data-action="reset">Cancella tutti i dati</button></div>`;
  return html;
}

// ---------- Render ----------

function render() {
  $('#top-date').textContent = dayLong(today());
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  $('.fab').hidden = view !== 'plan';
  const v = $('#view');
  v.innerHTML = view === 'plan' ? renderPlan() : view === 'stats' ? renderStats() : renderSettings();
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

function snapshot() {
  const copy = JSON.stringify(state);
  return () => { state = JSON.parse(copy); commit('Annullato'); };
}

// ---------- Eventi ----------

document.addEventListener('click', async (ev) => {
  const tab = ev.target.closest('.tabs button');
  if (tab) { view = tab.dataset.view; render(); window.scrollTo(0, 0); return; }
  const el = ev.target.closest('[data-action]');
  if (!el || el.tagName === 'INPUT') return;
  const a = el.dataset.action;
  const id = el.dataset.id;
  const date = el.dataset.date;
  const type = el.dataset.type;
  const find = () => state.entries.find((x) => x.id === id);
  ev.stopPropagation();

  switch (a) {
    case 'close': closeSheet(); break;
    case 'undo': if (undoFn) { const f = undoFn; undoFn = null; $('#toast').hidden = true; f(); } break;
    case 'more-past': pastDays = pastDays >= 28 ? 7 : pastDays + 14; render(); break;
    case 'day': daySheet(date); break;
    case 'add': {
      const d = date || today();
      const sug = plan(state, today()).days.find((x) => x.date === d)?.suggestion?.type;
      editorSheet(newEntry(d, sug && sug !== 'rest' ? sug : 'pull', d <= today() ? 'done' : 'planned'));
      break;
    }
    case 'edit': { const e = find(); if (e) editorSheet(e); break; }
    case 'checkin': {
      const t = today();
      state.checkins[t] = { ...(state.checkins[t] || {}) };
      const k = el.dataset.k, v = el.dataset.v;
      state.checkins[t][k] = k === 'stiff' ? v === 'yes' : v;
      commit();
      break;
    }
    case 'pain': state.flags.pain = !state.flags.pain; commit(state.flags.pain ? 'Ok, niente gambe pesanti né sprint finché non passa' : 'Ottimo, piano completo di nuovo'); break;
    case 'accept': {
      const u = snapshot();
      state.entries.push(newEntry(date, type, 'planned'));
      closeSheet();
      commit(`${T(type).label} pianificato ${relName(date)}`, u);
      break;
    }
    case 'accept-done': {
      const u = snapshot();
      const e = newEntry(date, type, 'done');
      state.entries.push(e);
      commit(type === 'rest' ? 'Riposo registrato' : 'Registrato. Tocca per aggiustare durata e fatica', u);
      break;
    }
    case 'mark-done': {
      const e = find(); if (!e) break;
      const u = snapshot();
      e.status = 'done';
      if (!e.rpe && e.type !== 'rest') e.rpe = T(e.type).rpe;
      closeSheet();
      commit('Fatto', u);
      break;
    }
    case 'mark-skip': { const e = find(); if (!e) break; const u = snapshot(); e.status = 'skipped'; closeSheet(); commit('Segnato come saltato', u); break; }
    case 'swap': { const e = find(); if (!e) break; const u = snapshot(); e.type = type; e.dur = T(type).dur; commit(`Cambiato in ${T(type).label.toLowerCase()}`, u); break; }
    case 'ghost-confirm': case 'ghost-done': {
      const u = snapshot();
      const e = newEntry(date, 'calcetto', a === 'ghost-done' ? 'done' : 'planned');
      state.entries.push(e);
      closeSheet();
      commit(a === 'ghost-done' ? 'Calcetto registrato' : 'Calcetto confermato', u);
      if (a === 'ghost-done') editorSheet(e);
      break;
    }
    case 'no-calcetto': {
      const u = snapshot();
      const s = settings();
      state.settings = { ...state.settings, noCalcetto: [...s.noCalcetto.filter((x) => x >= toS(toN(today()) - 30)), date] };
      closeSheet();
      commit('Ok, niente calcetto: piano aggiornato', u);
      break;
    }
    // Editor
    case 'd-type': {
      readDraft();
      const prev = draft.type;
      draft.type = type;
      if (!draft.dur || draft.dur === T(prev).dur) draft.dur = T(type).dur;
      if (draft.status === 'done' && (!draft.rpe || draft.rpe === T(prev).rpe)) draft.rpe = T(type).rpe;
      el.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === el));
      $('#d-guide').textContent = T(type).guide;
      $('[name=dur]').value = draft.dur ?? '';
      document.querySelectorAll('.rpe button').forEach((b) => b.classList.toggle('on', +b.dataset.v === draft.rpe));
      syncEditor();
      break;
    }
    case 'd-status': {
      draft.status = el.dataset.v;
      if (draft.status === 'done' && !draft.rpe) {
        draft.rpe = T(draft.type).rpe;
        document.querySelectorAll('.rpe button').forEach((b) => b.classList.toggle('on', +b.dataset.v === draft.rpe));
      }
      el.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === el));
      syncEditor();
      break;
    }
    case 'd-dur': { const inp = $('[name=dur]'); inp.value = Math.max(0, (parseInt(inp.value, 10) || 0) + +el.dataset.v); break; }
    case 'd-rpe': draft.rpe = +el.dataset.v; el.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === el)); break;
    case 'd-save': {
      readDraft();
      const u = snapshot();
      if (draft.status !== 'done') delete draft.rpe;
      const i = state.entries.findIndex((x) => x.id === draft.id);
      if (i >= 0) state.entries[i] = draft; else state.entries.push(draft);
      closeSheet();
      commit('Salvato', u);
      break;
    }
    case 'd-delete': {
      const u = snapshot();
      state.entries = state.entries.filter((x) => x.id !== draft.id);
      closeSheet();
      commit('Eliminato', u);
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
      if (await store.exportJSON(state)) { state.meta.lastExport = new Date().toISOString(); commit('Backup creato'); }
      break;
    }
    case 'demo': state = demoState(); commit('Dati di esempio caricati'); break;
    case 'reset': {
      if (confirm('Cancellare tutti i dati? Fai prima un backup se vuoi tenerli.')) { const u = snapshot(); state = store.emptyState(); commit('Dati cancellati', u); }
      break;
    }
  }
});

document.addEventListener('change', async (ev) => {
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
    toast('File non valido');
  }
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

// Ricalcola quando cambia il giorno (app lasciata aperta) o si torna in primo piano.
let lastDay = today();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { state = store.load(); if (today() !== lastDay) lastDay = today(); render(); }
});

// ---------- Dati di esempio ----------

function demoState() {
  const s = store.emptyState();
  const t = toN(today());
  const add = (k, type, extra = {}) => s.entries.push({ ...newEntry(toS(t + k), type, k < 0 ? 'done' : 'planned'), ...extra });
  const pattern = [
    [-27, 'legs_heavy'], [-26, 'pull'], [-24, 'hills_short'], [-23, 'push'], [-22, 'run_easy'], [-21, 'calcetto'],
    [-19, 'pull'], [-18, 'legs_heavy'], [-16, 'push'], [-15, 'run_strides'], [-14, 'calcetto'],
    [-12, 'push'], [-11, 'legs_heavy'], [-10, 'pull'], [-9, 'hills_long'], [-8, 'run_easy'], [-7, 'calcetto', { rpe: 9 }],
    [-6, 'mobility'], [-5, 'pull'], [-4, 'calisthenics'], [-3, 'hills_short'], [-2, 'hike', { dur: 200 }],
  ];
  for (const [k, type, extra] of pattern) add(k, type, extra);
  return s;
}

// ---------- Avvio ----------

render();
store.persist().then((p) => { persisted = p; if (view === 'settings') render(); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
