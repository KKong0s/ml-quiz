'use strict';

const STATE_KEY = 'mlq-state-v1';
const THEME_KEY = 'mlq-theme';
const LETTERS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/* ---------- storage (ครอบ try/catch ทุกครั้ง) ---------- */
function lsGet(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}
function lsSet(key, value) {
  try { localStorage.setItem(key, value); } catch (e) { /* ignore */ }
}

/* ---------- seeded random ---------- */
function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffled(arr, seed) {
  const a = arr.slice();
  const rand = mulberry32(seed);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ---------- state ---------- */
function defaultState() {
  return {
    set: 'all',
    shuffleOpts: false,
    shuffleQs: false,
    qSeed: 1,
    onlyWrong: false,
    onlyUnanswered: false,
    current: null,
    answers: {} // id -> { choice } (mc) | { picks: [] } (match), พร้อม correct: bool
  };
}

let state = defaultState();
let DATA = null;
let moduleById = new Map();
let view = [];            // รายการข้อที่กำลังแสดง (หลังกรอง)
const drafts = {};        // ค่าที่เลือกไว้ในข้อจับคู่ที่ยังไม่กดตรวจ

function loadState() {
  const raw = lsGet(STATE_KEY);
  if (!raw) return;
  try {
    const s = JSON.parse(raw);
    state = { ...defaultState(), ...s, answers: (s && s.answers) || {} };
  } catch (e) { /* ignore */ }
}
function saveState() {
  lsSet(STATE_KEY, JSON.stringify(state));
}

/* ---------- question lists ---------- */
function baseList() {
  const all = DATA.questions;
  const list = state.set === 'all' ? all : all.filter((q) => q.module === state.set);
  if (!state.shuffleQs) return list;
  return shuffled(list, (state.qSeed ^ hashStr(state.set)) >>> 0);
}

function matchesFilter(q) {
  const a = state.answers[q.id];
  if (state.onlyWrong && !(a && !a.correct)) return false;
  if (state.onlyUnanswered && a) return false;
  return true;
}

// ใช้ตอนเปลี่ยนชุด/ตัวกรอง: ถ้าข้อปัจจุบันไม่ผ่านตัวกรอง ให้ไปข้อแรกที่ผ่าน
function rebuildView() {
  view = baseList().filter(matchesFilter);
  if (!view.some((q) => q.id === state.current)) {
    state.current = view.length ? view[0].id : null;
  }
}

// ใช้ตอนตอบ/เปลี่ยนข้อ: คงข้อปัจจุบันไว้ในรายการ แม้จะไม่ผ่านตัวกรองแล้ว
function refreshView() {
  const base = baseList();
  view = base.filter((q) => matchesFilter(q) || q.id === state.current);
  if (!view.some((q) => q.id === state.current)) {
    view = base.filter(matchesFilter);
    state.current = view.length ? view[0].id : null;
  }
}

function currentIndex() {
  return view.findIndex((q) => q.id === state.current);
}

function optionOrder(q) {
  const idx = q.options.map((_, i) => i);
  return state.shuffleOpts ? shuffled(idx, hashStr(q.id)) : idx;
}

function matchChoices(q) {
  const uniq = [...new Set(q.pairs.map((p) => p.answer))];
  return shuffled(uniq, hashStr(q.id + '#match'));
}

/* ---------- actions ---------- */
function go(delta) {
  const i = currentIndex();
  if (i < 0) return;
  const j = i + delta;
  if (j < 0 || j >= view.length) return;
  state.current = view[j].id;
  refreshView();
  render();
  scrollCardIntoView();
}

function jumpTo(id) {
  state.current = id;
  refreshView();
  render();
  scrollCardIntoView();
}

function scrollCardIntoView() {
  const card = $('card');
  const rect = card.getBoundingClientRect();
  if (rect.top < 0 || rect.top > window.innerHeight * 0.6) {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    card.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }
}

function answerMc(q, choice) {
  if (state.answers[q.id]) return;
  state.answers[q.id] = { choice, correct: choice === q.answer };
  render();
}

function checkMatch(q) {
  const picks = drafts[q.id] || [];
  if (state.answers[q.id] || q.pairs.some((_, i) => !picks[i])) return;
  const correct = q.pairs.every((p, i) => picks[i] === p.answer);
  state.answers[q.id] = { picks: picks.slice(), correct };
  delete drafts[q.id];
  render();
}

function clearSet() {
  const ids = (state.set === 'all' ? DATA.questions : DATA.questions.filter((q) => q.module === state.set)).map((q) => q.id);
  ids.forEach((id) => { delete state.answers[id]; delete drafts[id]; });
  rebuildView();
  if (view.length) state.current = view[0].id;
  render();
}

/* ---------- rendering ---------- */
function setLabel(id) {
  if (id === 'all') return 'ทั้งหมด';
  const m = moduleById.get(id);
  return m ? m.name : id;
}

function buildSets() {
  const wrap = $('sets');
  wrap.textContent = '';
  const counts = {};
  DATA.questions.forEach((q) => { counts[q.module] = (counts[q.module] || 0) + 1; });

  const items = [{ id: 'all', name: 'ทั้งหมด', sub: `${DATA.questions.length} ข้อ` }];
  DATA.modules.forEach((m) => {
    const [head, ...rest] = m.name.split('·');
    items.push({ id: m.id, name: `${head.trim()} · ${counts[m.id] || 0} ข้อ`, sub: rest.join('·').trim(), title: m.name });
  });

  items.forEach((it) => {
    const b = el('button', 'set-btn');
    b.type = 'button';
    b.dataset.set = it.id;
    if (it.title) b.title = it.title;
    b.append(el('span', 'set-name', it.name), el('span', 'set-count', it.sub));
    b.addEventListener('click', () => {
      if (state.set === it.id) return;
      state.set = it.id;
      state.current = null;
      hideConfirm();
      rebuildView();
      render();
    });
    wrap.append(b);
  });
}

function renderSets() {
  document.querySelectorAll('.set-btn').forEach((b) => {
    const on = b.dataset.set === state.set;
    b.setAttribute('aria-pressed', String(on));
    if (on && b.scrollIntoView && b.parentElement.scrollWidth > b.parentElement.clientWidth) {
      const p = b.parentElement;
      const left = b.offsetLeft - p.offsetLeft;
      if (left < p.scrollLeft || left + b.offsetWidth > p.scrollLeft + p.clientWidth) p.scrollLeft = left - 16;
    }
  });
}

function renderControls() {
  $('optShuffleOpts').checked = state.shuffleOpts;
  $('optShuffleQs').checked = state.shuffleQs;
  $('optOnlyWrong').checked = state.onlyWrong;
  $('optOnlyUnanswered').checked = state.onlyUnanswered;
}

function renderSummary() {
  const list = state.set === 'all' ? DATA.questions : DATA.questions.filter((q) => q.module === state.set);
  let ok = 0, bad = 0;
  list.forEach((q) => {
    const a = state.answers[q.id];
    if (a) a.correct ? ok++ : bad++;
  });
  const done = ok + bad;
  const total = list.length;
  $('stDone').textContent = `${done}/${total}`;
  $('stOk').textContent = ok;
  $('stBad').textContent = bad;
  $('stPct').textContent = done ? `${Math.round((ok / done) * 100)}%` : '–';
  $('pgOk').style.width = total ? `${(ok / total) * 100}%` : '0';
  $('pgBad').style.width = total ? `${(bad / total) * 100}%` : '0';
  $('progress').setAttribute('aria-label', `ความคืบหน้า: ทำแล้ว ${done} จาก ${total} ข้อ ถูก ${ok} ผิด ${bad}`);
}

function renderEmpty(card) {
  const box = el('div', 'empty');
  let msg = 'ไม่มีข้อที่ตรงกับตัวกรอง';
  let sub = 'ลองปิดตัวกรอง หรือเลือกชุดข้อสอบอื่น';
  if (state.onlyWrong) { msg = 'ไม่มีข้อที่ตอบผิดในชุดนี้'; sub = 'เยี่ยมมาก หรือยังไม่ได้เริ่มทำ ลองปิดตัวกรอง "เฉพาะข้อที่ผิด"'; }
  if (state.onlyUnanswered) { msg = 'ทำครบทุกข้อในชุดนี้แล้ว'; sub = 'ปิดตัวกรอง "เฉพาะข้อที่ยังไม่ทำ" เพื่อดูคำตอบ หรือล้างคำตอบเพื่อเริ่มใหม่'; }
  box.append(el('strong', null, msg), el('span', null, sub));
  card.append(box);
}

function renderCard() {
  const card = $('card');
  card.textContent = '';
  const i = currentIndex();
  if (i < 0) { renderEmpty(card); return; }
  const q = view[i];

  const meta = el('div', 'meta');
  meta.append(
    el('span', 'q-pos', `ข้อ ${i + 1} / ${view.length}`),
    el('span', 'q-type', q.type === 'match' ? 'จับคู่' : 'ปรนัย'),
    el('span', 'q-module', setLabel(q.module)),
    el('span', 'q-source', q.source || '')
  );
  card.append(meta);

  const qText = el('h2', 'q-text', q.question);
  qText.id = 'qText';
  card.append(qText);

  if (q.type === 'match') renderMatch(card, q);
  else renderMc(card, q);
}

function renderMc(card, q) {
  const a = state.answers[q.id];
  const order = optionOrder(q);
  const ul = el('ul', 'options');
  ul.setAttribute('aria-labelledby', 'qText');
  let correctLetter = '';

  order.forEach((orig, pos) => {
    const li = el('li');
    const b = el('button', 'opt');
    b.type = 'button';
    const letter = LETTERS[pos];
    if (orig === q.answer) correctLetter = letter;
    b.append(el('span', 'opt-letter', letter), el('span', 'opt-text', q.options[orig]));
    if (a) {
      b.disabled = true;
      if (orig === q.answer) b.classList.add('is-correct');
      else if (orig === a.choice) b.classList.add('is-wrong');
      if (orig === a.choice) b.setAttribute('aria-label', `${letter}. ${q.options[orig]} (คำตอบที่เลือก)`);
    } else {
      b.addEventListener('click', () => answerMc(q, orig));
    }
    li.append(b);
    ul.append(li);
  });
  card.append(ul);

  if (a) {
    const fb = el('div', `feedback ${a.correct ? 'ok' : 'bad'}`);
    fb.append(el('p', 'feedback-title', a.correct ? 'ถูกต้อง' : `ยังไม่ถูก คำตอบคือ ${correctLetter}.`));
    if (q.explanation) fb.append(el('p', 'feedback-body', q.explanation));
    card.append(fb);
  }
}

function renderMatch(card, q) {
  const a = state.answers[q.id];
  const choices = matchChoices(q);
  const picks = a ? a.picks : (drafts[q.id] || (drafts[q.id] = []));
  const list = el('div', 'match-list');
  let checkBtn;

  const updateBtn = () => {
    if (checkBtn) checkBtn.disabled = q.pairs.some((_, i) => !picks[i]);
  };

  q.pairs.forEach((p, i) => {
    const row = el('div', 'match-row');
    const selId = `m-${q.id}-${i}`;
    const label = el('label', 'match-term', p.term);
    label.htmlFor = selId;

    const sel = el('select');
    sel.id = selId;
    const ph = el('option', null, '— เลือกคำอธิบาย —');
    ph.value = '';
    sel.append(ph);
    choices.forEach((c) => {
      const o = el('option', null, c);
      o.value = c;
      sel.append(o);
    });
    sel.value = picks[i] || '';

    row.append(label, sel);

    if (a) {
      sel.disabled = true;
      const ok = picks[i] === p.answer;
      row.classList.add(ok ? 'is-correct' : 'is-wrong');
      if (!ok) {
        const fix = el('p', 'match-fix');
        fix.append(el('strong', null, 'คำตอบที่ถูก: '), document.createTextNode(p.answer));
        row.append(fix);
      }
    } else {
      sel.addEventListener('change', () => {
        picks[i] = sel.value;
        updateBtn();
      });
    }
    list.append(row);
  });
  card.append(list);

  if (a) {
    const okCount = q.pairs.filter((p, i) => a.picks[i] === p.answer).length;
    const fb = el('div', `feedback ${a.correct ? 'ok' : 'bad'}`);
    fb.append(el('p', 'feedback-title', a.correct ? 'ถูกต้อง ครบทุกคู่' : `ยังไม่ถูก ถูก ${okCount} จาก ${q.pairs.length} คู่`));
    if (q.explanation) fb.append(el('p', 'feedback-body', q.explanation));
    card.append(fb);
  } else {
    const actions = el('div', 'match-actions');
    checkBtn = el('button', 'btn btn-primary', 'ตรวจคำตอบ');
    checkBtn.type = 'button';
    checkBtn.addEventListener('click', () => checkMatch(q));
    actions.append(checkBtn);
    card.append(actions);
    updateBtn();
  }
}

function renderNav() {
  const i = currentIndex();
  $('prevBtn').disabled = i <= 0;
  $('nextBtn').disabled = i < 0 || i >= view.length - 1;
  $('navPos').textContent = i >= 0 ? `${i + 1}/${view.length}` : '';
}

function renderMap() {
  const map = $('map');
  map.textContent = '';
  const frag = document.createDocumentFragment();
  view.forEach((q, i) => {
    const a = state.answers[q.id];
    const b = el('button', 'map-btn' + (a ? (a.correct ? ' ok' : ' bad') : ''), String(i + 1));
    b.type = 'button';
    const status = a ? (a.correct ? 'ถูก' : 'ผิด') : 'ยังไม่ทำ';
    b.setAttribute('aria-label', `ข้อ ${i + 1}: ${status}`);
    if (q.id === state.current) b.setAttribute('aria-current', 'true');
    b.addEventListener('click', () => jumpTo(q.id));
    frag.append(b);
  });
  map.append(frag);
}

function render() {
  renderSets();
  renderControls();
  renderSummary();
  renderCard();
  renderNav();
  renderMap();
  saveState();
}

/* ---------- confirm clear (ในหน้าเว็บ ไม่ใช้ confirm()) ---------- */
function showConfirm() {
  const n = (state.set === 'all' ? DATA.questions : DATA.questions.filter((q) => q.module === state.set))
    .filter((q) => state.answers[q.id]).length;
  $('confirmText').textContent = n
    ? `ล้างคำตอบ ${n} ข้อในชุด "${setLabel(state.set)}" ใช่ไหม? ย้อนกลับไม่ได้`
    : `ชุด "${setLabel(state.set)}" ยังไม่มีคำตอบให้ล้าง`;
  $('confirmYes').hidden = n === 0;
  $('confirmBox').hidden = false;
  $('clearBtn').setAttribute('aria-expanded', 'true');
  (n ? $('confirmYes') : $('confirmNo')).focus();
}
function hideConfirm() {
  $('confirmBox').hidden = true;
  $('clearBtn').setAttribute('aria-expanded', 'false');
}

/* ---------- theme ---------- */
function effectiveTheme() {
  const t = document.documentElement.dataset.theme;
  if (t === 'light' || t === 'dark') return t;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function syncThemeUi() {
  const dark = effectiveTheme() === 'dark';
  $('themeText').textContent = dark ? 'โหมดสว่าง' : 'โหมดมืด';
  $('themeBtn').setAttribute('aria-label', dark ? 'เปลี่ยนเป็นโหมดสว่าง' : 'เปลี่ยนเป็นโหมดมืด');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? '#191c23' : '#2f5bd3';
}
function toggleTheme() {
  const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  lsSet(THEME_KEY, next);
  syncThemeUi();
}

/* ---------- events ---------- */
function bindEvents() {
  $('prevBtn').addEventListener('click', () => go(-1));
  $('nextBtn').addEventListener('click', () => go(1));
  $('themeBtn').addEventListener('click', toggleTheme);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncThemeUi);

  $('optShuffleOpts').addEventListener('change', (e) => {
    state.shuffleOpts = e.target.checked;
    render();
  });
  $('optShuffleQs').addEventListener('change', (e) => {
    state.shuffleQs = e.target.checked;
    if (state.shuffleQs) state.qSeed = (Math.random() * 2 ** 32) >>> 0;
    rebuildView();
    render();
  });
  $('optOnlyWrong').addEventListener('change', (e) => {
    state.onlyWrong = e.target.checked;
    if (state.onlyWrong) state.onlyUnanswered = false;
    rebuildView();
    render();
  });
  $('optOnlyUnanswered').addEventListener('change', (e) => {
    state.onlyUnanswered = e.target.checked;
    if (state.onlyUnanswered) state.onlyWrong = false;
    rebuildView();
    render();
  });

  $('clearBtn').addEventListener('click', () => {
    if ($('confirmBox').hidden) showConfirm(); else hideConfirm();
  });
  $('confirmNo').addEventListener('click', () => { hideConfirm(); $('clearBtn').focus(); });
  $('confirmYes').addEventListener('click', () => { clearSet(); hideConfirm(); $('clearBtn').focus(); });

  document.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target;
    if (t && t.closest && t.closest('select, input, textarea, [contenteditable="true"]')) return;
    if (e.key === 'Escape' && !$('confirmBox').hidden) { hideConfirm(); return; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); go(1); return; }
    if (/^[1-9]$/.test(e.key)) {
      const q = view[currentIndex()];
      if (!q || q.type !== 'mc' || state.answers[q.id]) return;
      const order = optionOrder(q);
      const pos = Number(e.key) - 1;
      if (pos < order.length) answerMc(q, order[pos]);
    }
  });

  // swipe ซ้าย/ขวาบนการ์ด
  const card = $('card');
  let sx = 0, sy = 0, tracking = false;
  card.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || e.target.closest('select')) { tracking = false; return; }
    sx = e.touches[0].clientX;
    sy = e.touches[0].clientY;
    tracking = true;
  }, { passive: true });
  card.addEventListener('touchend', (e) => {
    if (!tracking) return;
    tracking = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx;
    const dy = t.clientY - sy;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
  }, { passive: true });
}

/* ---------- boot ---------- */
function validate(data) {
  const qs = data.questions || [];
  const mc = qs.filter((q) => q.type === 'mc');
  const badMc = mc.filter((q) => !Array.isArray(q.options) || q.options.length !== 5 || !(q.answer >= 0 && q.answer <= 4));
  console.info(`[ML Quiz] โหลด ${qs.length} ข้อ (mc ${mc.length}, match ${qs.length - mc.length})`);
  if (badMc.length) console.warn('[ML Quiz] ข้อ mc ที่รูปแบบไม่ถูกต้อง:', badMc.map((q) => q.id));
}

async function init() {
  syncThemeUi();
  bindEvents();
  try {
    const res = await fetch('./questions.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    DATA = await res.json();
  } catch (err) {
    const card = $('card');
    card.textContent = '';
    const box = el('div', 'empty');
    box.append(
      el('strong', null, 'โหลดข้อสอบไม่สำเร็จ'),
      el('span', null, location.protocol === 'file:'
        ? 'กรุณาเปิดผ่านเว็บเซิร์ฟเวอร์ (เช่น Live Server หรือ npx serve .) แทนการเปิดไฟล์โดยตรง'
        : 'ตรวจสอบการเชื่อมต่ออินเทอร์เน็ต แล้วลองรีโหลดหน้าเว็บ')
    );
    card.append(box);
    $('course').textContent = '';
    console.error(err);
    return;
  }

  validate(DATA);
  moduleById = new Map(DATA.modules.map((m) => [m.id, m]));
  $('course').textContent = DATA.course || '';

  loadState();
  if (state.set !== 'all' && !moduleById.has(state.set)) state.set = 'all';
  // ลบคำตอบของข้อที่ไม่มีแล้ว (กรณีแก้ questions.json)
  const ids = new Set(DATA.questions.map((q) => q.id));
  Object.keys(state.answers).forEach((id) => { if (!ids.has(id)) delete state.answers[id]; });

  buildSets();
  refreshView();
  render();
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('[ML Quiz] SW', e));
  });
}

init();
