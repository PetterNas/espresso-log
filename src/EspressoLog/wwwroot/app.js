'use strict';

const $ = (sel) => document.querySelector(sel);
const QUEUE_KEY = 'espresso.queue';
const CACHE_KEY = 'espresso.shots';
const BEANS_KEY = 'espresso.beans';
const DEFAULT_DOSE = 18;
const DEFAULT_YIELD = 36;
const TABS = ['log', 'beans', 'history', 'charts'];
const TAG_LABELS = {
  sour: 'Sour', bitter: 'Bitter', balanced: 'Balanced', sweet: 'Sweet',
  watery: 'Watery', syrupy: 'Syrupy', channeling: 'Channeling',
};
// Dial-in hints. Most grinders get finer as the number goes down; use +1 if yours is the other way round.
const FINER = -1;
const GRIND_STEP = 0.5;
const TARGET_TIME = [25, 32];  // seconds; outside this range with no taste tags, nudge the grind
const LOW_SHOTS = 3;           // warn when the bag has this many shots or fewer left

const state = {
  shots: [],         // newest first, from server
  beans: [],         // all beans incl. finished; active first, most recently used first
  editingId: null,
  signedOut: false,  // the login proxy redirected an API call
  tags: new Set(),
  editingBeanId: null,
  rating: null,
  beanRating: null,
  photo: { blob: null, remove: false },  // pending change in the bean form
  charts: {},
};

// ---------- storage helpers ----------

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function store(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

// ---------- API ----------

// Behind a login proxy (Authelia) an expired session answers API calls with a redirect.
// Don't follow it: flag the session and fail like a network error, so shots get queued.
async function send(path, options) {
  const res = await fetch('/api' + path, { ...options, redirect: 'manual' });
  if (res.type === 'opaqueredirect') {
    state.signedOut = true;
    updateStatus();
    throw new Error('Signed out');
  }
  return res;
}

async function api(path, options = {}) {
  const res = await send(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body.errors) message = Object.values(body.errors).flat().join(' ');
      else if (body.detail) message = body.detail;
    } catch { /* not json */ }
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

async function refresh() {
  try {
    [state.shots, state.beans] = await Promise.all([api('/shots'), api('/beans?includeFinished=true')]);
    store(CACHE_KEY, state.shots);
    store(BEANS_KEY, state.beans);
  } catch (e) {
    if (e.status) throw e;
    state.shots = load(CACHE_KEY, []);  // offline: show last known data
    state.beans = load(BEANS_KEY, []);
  }
  renderAll();
}

// ---------- offline queue ----------

function queued() { return load(QUEUE_KEY, []); }

let flushing = null;

// 'online' and 'visibilitychange' often fire together; share one run so nothing is posted twice.
function flushQueue() {
  flushing ??= doFlush().finally(() => { flushing = null; });
  return flushing;
}

async function doFlush() {
  const queue = queued();
  if (!queue.length) return;
  const remaining = [];
  for (const shot of queue) {
    try {
      await api('/shots', { method: 'POST', body: JSON.stringify(shot) });
    } catch (e) {
      // Keep network failures for later; drop entries the server rejects outright.
      if (!e.status) remaining.push(shot);
    }
  }
  // Keep anything queued while this flush was running.
  store(QUEUE_KEY, [...remaining, ...queued().slice(queue.length)]);
  if (remaining.length < queue.length) await refresh();
  updateStatus();
}

function updateStatus() {
  const n = queued().length;
  const el = $('#status');
  el.hidden = n === 0 && !state.signedOut;
  el.textContent = state.signedOut ? (n ? `${n} unsynced · Sign in` : 'Sign in') : `${n} unsynced`;
}

// ---------- number parsing (accepts "17,5" as well as "17.5") ----------

function num(value) {
  if (value == null || String(value).trim() === '') return null;
  const n = Number(String(value).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}
function fmt(n, digits = 1) {
  if (n == null) return '';
  return Number.isInteger(n) ? String(n) : n.toFixed(digits).replace(/\.0+$/, '');
}

// ---------- beans helpers ----------

function activeBeans() { return state.beans.filter((b) => !b.finished); }
function beanById(id) { return state.beans.find((b) => b.id === id); }

// Queued (newest first) followed by synced shots, so defaults also see shots made offline.
function allShots() { return [...queued().slice().reverse(), ...state.shots]; }

// ---------- shot form ----------

function renderBeanSelect() {
  const select = $('#bean');
  const current = Number(select.value) || null;
  const editing = state.editingId ? state.shots.find((s) => s.id === state.editingId) : null;
  const beans = activeBeans();
  // A shot being edited may belong to a finished bag; keep it selectable.
  if (editing && !beans.some((b) => b.id === editing.beanId)) {
    beans.push(beanById(editing.beanId) ?? { id: editing.beanId, name: editing.beanName });
  }
  select.innerHTML = beans.map((b) => `<option value="${b.id}">${esc(b.name)}${b.roaster ? ' · ' + esc(b.roaster) : ''}</option>`).join('');

  const none = beans.length === 0;
  $('#no-beans').hidden = !none;
  $('#shot-form').hidden = none;
  $('#recent-panel').hidden = none;

  if (beans.some((b) => b.id === current)) select.value = current;
  else if (!none && !state.editingId) { select.value = defaultBeanId(); applyGrindDefault(); }
}

function defaultBeanId() {
  const beans = activeBeans();
  const lastBean = allShots().find((s) => beans.some((b) => b.id === s.beanId))?.beanId;
  return lastBean ?? beans[0]?.id ?? '';
}

// Start from the last grind used with these beans, or else the most recent shot's grind.
function applyGrindDefault() {
  const beanId = Number($('#bean').value);
  const shots = allShots();
  const ref = shots.find((s) => s.beanId === beanId) ?? shots[0];
  $('#grind').value = fmt(ref?.grindSetting);
  $('#grind').classList.remove('invalid');
  renderRecent();
}

function clearValidation(form) {
  form.querySelectorAll('.invalid').forEach((el) => el.classList.remove('invalid'));
}

function fillForm(shot) {
  renderBeanSelect();
  $('#bean').value = shot.beanId;
  $('#grind').value = fmt(shot.grindSetting);
  $('#dose').value = fmt(shot.doseGrams);
  $('#yield').value = fmt(shot.yieldGrams);
  $('#time').value = shot.timeSeconds ?? '';
  $('#notes').value = shot.notes ?? '';
  setRating(shot.rating ?? null);
  setTags(shot.tags);
  $('#best').checked = !!shot.best;
  renderRecent();
  clearValidation($('#shot-form'));
  showError('');
}

function prefillNew() {
  renderBeanSelect();
  $('#bean').value = defaultBeanId();
  applyGrindDefault();
  $('#dose').value = String(DEFAULT_DOSE);
  $('#yield').value = String(DEFAULT_YIELD);
  $('#time').value = '';
  $('#notes').value = '';
  setRating(null);
  setTags([]);
  $('#best').checked = false;
  clearValidation($('#shot-form'));
  showError('');
}

function setRating(v) {
  state.rating = v;
  markRating('#rating', v);
}
function markRating(sel, v) {
  document.querySelectorAll(`${sel} button`).forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === v));
}
function bindRating(sel, get, set) {
  $(sel).addEventListener('click', (e) => {
    const v = Number(e.target.dataset?.v);
    if (v) set(get() === v ? null : v);
  });
}

function setTags(tags) {
  state.tags = new Set(tags ?? []);
  document.querySelectorAll('#tags button').forEach((b) => b.classList.toggle('on', state.tags.has(b.dataset.tag)));
}
function toggleTag(tag) {
  const next = new Set(state.tags);
  if (next.has(tag)) next.delete(tag); else next.add(tag);
  setTags(next);
}

function readForm() {
  const beanId = Number($('#bean').value) || null;
  const shot = {
    beanId,
    grindSetting: num($('#grind').value),
    doseGrams: num($('#dose').value),
    timeSeconds: num($('#time').value),
    yieldGrams: num($('#yield').value),
    rating: state.rating,
    notes: $('#notes').value.trim() || null,
    tags: Object.keys(TAG_LABELS).filter((t) => state.tags.has(t)),
    best: $('#best').checked,
  };
  const bad = [];
  if (!shot.beanId) bad.push('#bean');
  if (shot.grindSetting == null || Number.isNaN(shot.grindSetting)) bad.push('#grind');
  if (shot.doseGrams == null || Number.isNaN(shot.doseGrams)) bad.push('#dose');
  if (shot.timeSeconds == null || Number.isNaN(shot.timeSeconds)) bad.push('#time');
  if (Number.isNaN(shot.yieldGrams)) bad.push('#yield');
  clearValidation($('#shot-form'));
  bad.forEach((sel) => $(sel).classList.add('invalid'));
  if (shot.timeSeconds != null) shot.timeSeconds = Math.round(shot.timeSeconds);
  return bad.length ? null : shot;
}

function showError(message, sel = '#form-error') {
  const el = $(sel);
  el.textContent = message;
  el.hidden = !message;
}

async function onSubmit(e) {
  e.preventDefault();
  const shot = readForm();
  if (!shot) { showError('Fill in the highlighted fields.'); return; }

  const btn = $('#save');
  btn.disabled = true;
  try {
    if (state.editingId) {
      await api(`/shots/${state.editingId}`, { method: 'PUT', body: JSON.stringify(shot) });
      endEdit();
      await refresh();
      switchTab('history');
      return;
    }
    try {
      await api('/shots', { method: 'POST', body: JSON.stringify(shot) });
      await refresh();
      flash('Saved ✓');
    } catch (err) {
      if (err.status) throw err;
      // Offline: queue it with its real timestamp and sync later.
      const beanName = beanById(shot.beanId)?.name ?? '';
      store(QUEUE_KEY, [...queued(), { ...shot, beanName, createdAt: new Date().toISOString() }]);
      updateStatus();
      renderHistory();
      flash('Saved offline');
    }
    prefillNew();
    $('#time').focus({ preventScroll: true });
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
  }
}

function flash(text) {
  const btn = $('#save');
  const original = state.editingId ? 'Update shot' : 'Save shot';
  btn.textContent = text;
  setTimeout(() => { btn.textContent = original; }, 1200);
}

function startEdit(shot) {
  state.editingId = shot.id;
  fillForm(shot);
  $('#form-title').hidden = false;
  $('#form-title').textContent = formatDate(shot.createdAt);
  $('#save').textContent = 'Update shot';
  $('#cancel-edit').hidden = false;
  $('#delete').hidden = false;
  switchTab('log');
  window.scrollTo(0, 0);
}

function endEdit() {
  state.editingId = null;
  $('#form-title').hidden = true;
  $('#save').textContent = 'Save shot';
  $('#cancel-edit').hidden = true;
  $('#delete').hidden = true;
  prefillNew();
  updateTitle();
}

async function onDelete() {
  if (!state.editingId || !confirm('Delete this shot?')) return;
  try {
    await api(`/shots/${state.editingId}`, { method: 'DELETE' });
    endEdit();
    await refresh();
    switchTab('history');
  } catch (err) {
    showError(err.status ? err.message : 'Can’t delete while offline.');
  }
}

// ---------- bean photos ----------

function photoUrl(b) {
  return b?.photoUpdatedAt ? `/api/beans/${b.id}/photo?v=${encodeURIComponent(b.photoUpdatedAt)}` : null;
}

// Downscale on the device so uploads stay small (a phone photo becomes a few hundred KB).
async function shrinkImage(file, maxSide = 1600) {
  let img;
  try { img = await createImageBitmap(file); } catch { throw new Error('Couldn’t read that image. Try a JPEG or PNG.'); }
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  img.close?.();
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => (blob ? resolve(blob) : reject(new Error('Couldn’t process that image.'))), 'image/jpeg', 0.85));
}

function showPhoto(url) {
  const img = $('#b-photo-img');
  if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
  img.hidden = !url;
  if (url) img.src = url; else img.removeAttribute('src');
  $('#b-photo-empty').hidden = !!url;
  $('#b-photo-actions').hidden = !url;
}

async function onPhotoPicked() {
  const file = $('#b-photo-input').files[0];
  $('#b-photo-input').value = '';  // allow picking the same file again
  if (!file) return;
  try {
    state.photo = { blob: await shrinkImage(file), remove: false };
    showPhoto(URL.createObjectURL(state.photo.blob));
    showError('', '#bean-error');
  } catch (err) {
    showError(err.message, '#bean-error');
  }
}

function onPhotoRemove() {
  state.photo = { blob: null, remove: true };
  showPhoto(null);
}

async function savePhoto(beanId, hadPhoto) {
  const { blob, remove } = state.photo;
  if (!blob && !(remove && hadPhoto)) return;
  const res = await send(`/beans/${beanId}/photo`, blob
    ? { method: 'PUT', headers: { 'Content-Type': blob.type }, body: blob }
    : { method: 'DELETE' });
  if (!res.ok && res.status !== 404) {
    let message = `Photo upload failed (${res.status})`;
    try { message = (await res.json()).detail ?? message; } catch { /* not json */ }
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
}

// ---------- bean form ----------

const BEAN_FIELDS = {
  name: '#b-name', origin: '#b-origin',
  roastDate: '#b-roast', purchaseDate: '#b-bought', review: '#b-review',
};

// Dropdowns of previously used values, with "+ Add new…" revealing a text box.
const PICKERS = {
  roaster: { select: '#b-roaster-pick', input: '#b-roaster' },
  purchasedFrom: { select: '#b-from-pick', input: '#b-from' },
};
const ADD_NEW = '__new';

function renderPicker(key, value) {
  const { select, input } = PICKERS[key];
  const values = distinctValues(key);
  $(select).innerHTML = '<option value="">None</option>' +
    values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('') +
    `<option value="${ADD_NEW}">+ Add new…</option>`;
  $(select).value = value ?? '';
  $(input).value = '';
  $(input).hidden = true;
}

function readPicker(key) {
  const { select, input } = PICKERS[key];
  if ($(select).value !== ADD_NEW) return $(select).value || null;
  const typed = $(input).value.trim();
  // Reuse the existing spelling, so "drop coffee" doesn't become a second "Drop Coffee".
  return distinctValues(key).find((v) => v.toLowerCase() === typed.toLowerCase()) ?? (typed || null);
}

function bindPickers() {
  for (const { select, input } of Object.values(PICKERS)) {
    $(select).addEventListener('change', () => {
      const adding = $(select).value === ADD_NEW;
      $(input).hidden = !adding;
      $(input).classList.remove('invalid');
      if (adding) $(input).focus();
    });
  }
}

function setBeanRating(v) {
  state.beanRating = v;
  markRating('#b-rating', v);
}

function openBeanForm(bean) {
  state.editingBeanId = bean?.id ?? null;
  for (const [key, sel] of Object.entries(BEAN_FIELDS)) $(sel).value = bean?.[key] ?? '';
  for (const key of Object.keys(PICKERS)) renderPicker(key, bean?.[key]);
  state.photo = { blob: null, remove: false };
  showPhoto(photoUrl(bean));
  $('#b-price').value = fmt(bean?.price, 2);
  $('#b-amount').value = fmt(bean?.amountGrams);
  // Prefilled with the current estimate; only a changed value is sent as a new weigh-in.
  const left = bean ? bagStats(bean).left : null;
  $('#b-left').value = left != null && (bean.leftGrams != null || bean.usedGrams > 0) ? fmt(left, 0) : '';
  $('#b-left').dataset.initial = $('#b-left').value;
  $('#b-finished').checked = !!bean?.finished;
  setBeanRating(bean?.rating ?? null);
  clearValidation($('#bean-form'));
  showError('', '#bean-error');
  $('#bean-delete').hidden = !bean;
  $('#bean-save').textContent = bean ? 'Save changes' : 'Add beans';
  renderBeanShots(bean);
  $('#bean-list-view').hidden = true;
  $('#bean-form').hidden = false;
  updateTitle();
  window.scrollTo(0, 0);
  if (!bean) $('#b-name').focus({ preventScroll: true });
}

function closeBeanForm() {
  state.editingBeanId = null;
  $('#bean-form').hidden = true;
  $('#bean-list-view').hidden = false;
  updateTitle();
}

function readBeanForm() {
  const bean = { finished: $('#b-finished').checked, rating: state.beanRating };
  for (const [key, sel] of Object.entries(BEAN_FIELDS)) bean[key] = $(sel).value.trim() || null;
  for (const key of Object.keys(PICKERS)) bean[key] = readPicker(key);
  bean.price = num($('#b-price').value);
  bean.amountGrams = num($('#b-amount').value);
  const left = $('#b-left').value.trim();
  bean.leftGrams = left !== $('#b-left').dataset.initial ? num(left) : null;
  const bad = [];
  if (!bean.name) bad.push('#b-name');
  if (Number.isNaN(bean.price)) bad.push('#b-price');
  if (Number.isNaN(bean.amountGrams)) bad.push('#b-amount');
  if (Number.isNaN(bean.leftGrams)) bad.push('#b-left');
  for (const { select, input } of Object.values(PICKERS)) {
    if ($(select).value === ADD_NEW && !$(input).value.trim()) bad.push(input);
  }
  clearValidation($('#bean-form'));
  bad.forEach((sel) => $(sel).classList.add('invalid'));
  return bad.length ? null : bean;
}

async function onBeanSubmit(e) {
  e.preventDefault();
  const bean = readBeanForm();
  if (!bean) { showError('Fill in the highlighted fields.', '#bean-error'); return; }
  const btn = $('#bean-save');
  btn.disabled = true;
  try {
    const id = state.editingBeanId;
    const saved = await api(id ? `/beans/${id}` : '/beans', { method: id ? 'PUT' : 'POST', body: JSON.stringify(bean) });
    // Edits from here on update the saved bag, even if the photo upload below fails.
    state.editingBeanId = saved.id;
    await savePhoto(saved.id, !!saved.photoUpdatedAt);
    await refresh();
    closeBeanForm();
  } catch (err) {
    showError(err.status ? err.message : 'Can’t save while offline.', '#bean-error');
  } finally {
    btn.disabled = false;
  }
}

async function onBeanDelete() {
  if (!state.editingBeanId || !confirm('Delete these beans?')) return;
  try {
    await api(`/beans/${state.editingBeanId}`, { method: 'DELETE' });
    await refresh();
    closeBeanForm();
  } catch (err) {
    showError(err.status ? err.message : 'Can’t delete while offline.', '#bean-error');
  }
}

// ---------- rendering ----------

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) +
    ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

// Whole days from a yyyy-mm-dd date to a moment (default now), by local calendar day.
function daysSince(isoDate, until = new Date()) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const then = new Date(y, m - 1, d);
  const day = new Date(until);
  day.setHours(0, 0, 0, 0);
  return Math.round((day - then) / 86400000);
}

// "day 9": how long the beans had rested when the shot was pulled.
function restDay(shot) {
  const roast = beanById(shot.beanId)?.roastDate;
  if (!roast) return '';
  const d = daysSince(roast, shot.createdAt);
  return d >= 0 ? `day ${d}` : '';
}

function tagLine(s) {
  const tags = (s.tags ?? []).map((t) => TAG_LABELS[t] ?? t);
  return tags.length ? `<div class="tagline">${tags.map(esc).join(' · ')}</div>` : '';
}

function recipe(s) {
  return `<b>${fmt(s.grindSetting)}</b> · ${fmt(s.doseGrams)}${s.yieldGrams != null ? ` → ${fmt(s.yieldGrams)}` : ''} g · ${s.timeSeconds} s`;
}

// What's left in a bag, counting shots still waiting to sync, at the bag's average dose.
// Counts down from the last weigh-in if there is one, else from the full bag.
function bagStats(b) {
  const pending = queued().filter((s) => s.beanId === b.id);
  const shots = b.shotCount + pending.length;
  const used = b.usedGrams + pending.reduce((sum, s) => sum + s.doseGrams, 0);
  const dose = shots ? used / shots : DEFAULT_DOSE;
  let left = null;
  if (b.leftGrams != null) {
    const since = b.usedSinceLeftGrams + pending
      .filter((s) => new Date(s.createdAt) > new Date(b.leftAt))
      .reduce((sum, s) => sum + s.doseGrams, 0);
    left = Math.max(0, b.leftGrams - since);
  } else if (b.amountGrams != null) {
    left = Math.max(0, b.amountGrams - used);
  }
  return {
    left,
    shotsLeft: left != null ? Math.floor(left / dose) : null,
    costPerShot: b.price != null && b.amountGrams ? (b.price / b.amountGrams) * dose : null,
  };
}

function shotsLeftChip(b, st) {
  const n = st.shotsLeft;
  const text = n === 0 ? 'Bag empty?' : `≈ ${n} shot${n === 1 ? '' : 's'} left`;
  const cls = b.finished ? '' : n <= LOW_SHOTS ? ' warn' : ' accent';
  return `<span class="chip${cls}">${text} · ${fmt(st.left, 0)} g</span>`;
}

function stars(n) {
  return n ? `<span class="stars" aria-label="${n} of 5">${'★'.repeat(n)}${'☆'.repeat(5 - n)}</span>` : '';
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderFilters() {
  // Stable order (by creation) so filters and chart colours don't jump around.
  const beans = state.beans.slice().sort((a, b) => a.id - b.id).filter((b) => b.shotCount > 0);
  for (const id of ['#history-filter', '#chart-filter']) {
    const select = $(id);
    const current = select.value;
    select.innerHTML = '<option value="">All beans</option>' +
      beans.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('');
    select.value = beans.some((b) => String(b.id) === current) ? current : '';
  }
}

function beanCard(b) {
  const chips = [];
  if (b.roastDate) {
    const d = daysSince(b.roastDate);
    chips.push(`<span class="chip">${d <= 0 ? 'Roasted today' : `Roasted ${d} d ago`}</span>`);
  }
  const st = bagStats(b);
  if (st.left != null) chips.push(shotsLeftChip(b, st));
  chips.push(`<span class="chip">${b.shotCount} shot${b.shotCount === 1 ? '' : 's'}</span>`);
  if (b.bestShot) chips.push(`<span class="chip accent">★ Best ${fmt(b.bestShot.grindSetting)} · ${b.bestShot.timeSeconds} s</span>`);
  else if (b.lastGrind != null) chips.push(`<span class="chip">Grind ${fmt(b.lastGrind)}</span>`);
  if (b.price != null) chips.push(`<span class="chip">Price ${fmt(b.price, 2)}</span>`);
  if (st.costPerShot != null) chips.push(`<span class="chip">${fmt(st.costPerShot, 2)} / shot</span>`);
  const sub = [b.roaster, b.origin].filter(Boolean).map(esc).join(' · ');
  return `
    <li class="card" data-id="${b.id}">
      ${b.photoUpdatedAt ? `<img class="cover" src="${photoUrl(b)}" alt="" loading="lazy">` : ''}
      <div class="row1"><span class="title">${esc(b.name)}</span>${stars(b.rating)}</div>
      ${sub ? `<div class="sub">${sub}</div>` : ''}
      <div class="chips">${chips.join('')}</div>
      ${b.review ? `<div class="notes">${esc(b.review)}</div>` : ''}
    </li>`;
}

// Previously used values, most recently used first, de-duplicated ignoring case.
function distinctValues(key) {
  const seen = new Map();
  for (const b of state.beans) {
    const v = b[key]?.trim();
    if (v && !seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v);
  }
  return [...seen.values()];
}

function renderBeans() {
  const active = activeBeans();
  const finished = state.beans.filter((b) => b.finished);
  $('#bean-list').innerHTML = active.length
    ? active.map(beanCard).join('')
    : '<li class="empty">No beans yet. Add the bag you’re brewing.</li>';
  $('#finished-group').hidden = finished.length === 0;
  $('#finished-summary').textContent = `Finished (${finished.length})`;
  $('#finished-list').innerHTML = finished.map(beanCard).join('');
  document.querySelectorAll('#tab-beans .card').forEach((el) => {
    el.addEventListener('click', () => openBeanForm(beanById(Number(el.dataset.id))));
  });
}

function shotNums(s) {
  const parts = [
    `Grind <b>${fmt(s.grindSetting)}</b>`,
    `<b>${fmt(s.doseGrams)}</b> g` + (s.yieldGrams != null ? ` → <b>${fmt(s.yieldGrams)}</b> g` : ''),
    `<b>${s.timeSeconds}</b> s`,
  ];
  if (s.yieldGrams != null) parts.push(`1:${(s.yieldGrams / s.doseGrams).toFixed(1)}`);
  if (s.rating != null) parts.push(stars(s.rating));
  return parts;
}

// Queued and synced shots, newest first by when they were pulled (not when last edited).
function shotsNewestFirst() {
  const pending = queued().map((s) => ({ ...s, pending: true }));
  return [...pending, ...state.shots].sort((a, b) =>
    new Date(b.createdAt) - new Date(a.createdAt) || (b.id ?? Infinity) - (a.id ?? Infinity));
}

function dayLabel(iso) {
  const d = new Date(iso);
  const ago = daysSince(`${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`);
  if (ago === 0) return 'Today';
  if (ago === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: ago > 300 ? 'numeric' : undefined });
}

function shotCard(s, i) {
  const time = new Date(s.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `
    <li class="card${s.pending ? ' pending' : ''}" data-i="${i}">
      <div class="row1"><span>${time}${restDay(s) ? ' · ' + restDay(s) : ''}</span><span>${s.pending ? 'not synced' : '#' + s.id}</span></div>
      <div class="title">${esc(s.beanName)}${s.best ? ' <span class="badge-best">★ Best</span>' : ''}</div>
      <div class="nums">${shotNums(s).map((p) => `<span>${p}</span>`).join('')}</div>
      ${tagLine(s)}
      ${s.notes ? `<div class="notes">${esc(s.notes)}</div>` : ''}
    </li>`;
}

// One column of shot cards with a header before each day.
function renderShotList(list, shots, empty) {
  if (!shots.length) {
    list.innerHTML = `<li class="empty">${empty}</li>`;
    return;
  }
  let lastDay = null;
  list.innerHTML = shots.map((s, i) => {
    const day = dayLabel(s.createdAt);
    const head = day !== lastDay ? `<li class="day-head">${day}</li>` : '';
    lastDay = day;
    return head + shotCard(s, i);
  }).join('');
  list.querySelectorAll('.card').forEach((el) => {
    const shot = shots[Number(el.dataset.i)];
    if (!shot.pending) el.addEventListener('click', () => startEdit(shot));
  });
}

function renderHistory() {
  const filter = Number($('#history-filter').value) || null;
  renderShotList($('#history'), shotsNewestFirst().filter((s) => !filter || s.beanId === filter), 'No shots yet.');
}

function renderBeanShots(bean) {
  $('#bean-shots-panel').hidden = !bean;
  if (bean) renderShotList($('#bean-shots'), shotsNewestFirst().filter((s) => s.beanId === bean.id), 'No shots with these beans yet.');
}

// The last few shots with the beans picked in the form: the reference while dialing in.
function renderRecent() {
  const beanId = Number($('#bean').value) || null;
  const bean = beanById(beanId);
  const shots = allShots().filter((s) => s.beanId === beanId).slice(0, 6);
  $('#recent-title').innerHTML = (bean?.photoUpdatedAt ? `<img class="thumb" src="${photoUrl(bean)}" alt="">` : '') +
    `<span>${bean ? `Recent with ${esc(bean.name)}` : 'Recent shots'}</span>`;
  $('#recent').innerHTML = shots.length
    ? shots.map((s) => `
      <li>
        <div class="when">${formatDate(s.createdAt)}${restDay(s) ? ' · ' + restDay(s) : ''}${s.id ? '' : ' · not synced'}</div>
        <div class="grind">Grind <b>${fmt(s.grindSetting)}</b>${s.best ? ' <span class="badge-best">★ Best</span>' : ''}</div>
        <div class="nums">
          <span><b>${fmt(s.doseGrams)}</b>${s.yieldGrams != null ? ` → <b>${fmt(s.yieldGrams)}</b>` : ''} g</span>
          <span><b>${s.timeSeconds}</b> s</span>
          ${s.yieldGrams != null ? `<span>1:${(s.yieldGrams / s.doseGrams).toFixed(1)}</span>` : ''}
        </div>
        ${stars(s.rating)}
        ${tagLine(s)}
        ${s.notes ? `<div class="notes" title="${esc(s.notes)}">${esc(s.notes)}</div>` : ''}
      </li>`).join('')
    : '<li class="empty">No shots with these beans yet.</li>';
  renderBeanInfo(bean);
  renderGuide(bean, shots[0]);
}

function renderBeanInfo(bean) {
  const chips = [];
  if (bean?.roastDate) {
    const d = daysSince(bean.roastDate);
    if (d >= 0) chips.push(`<span class="chip">Day ${d} off roast</span>`);
  }
  if (bean) {
    const st = bagStats(bean);
    if (st.left != null) chips.push(shotsLeftChip(bean, st));
    if (st.costPerShot != null) chips.push(`<span class="chip">${fmt(st.costPerShot, 2)} / shot</span>`);
  }
  $('#bean-info').innerHTML = chips.join('');
  $('#bean-info').hidden = chips.length === 0;
}

// Suggest the next grind from the last shot: taste tags first, extraction time as a fallback.
function dialHint(s) {
  const t = new Set(s.tags ?? []);
  const what = [`${s.timeSeconds} s`, ...(s.tags ?? []).map((x) => (TAG_LABELS[x] ?? x).toLowerCase())].join(', ');
  const say = (dir, why) => {
    const grind = dir ? Math.max(0, Math.round((s.grindSetting + dir * FINER * GRIND_STEP) / GRIND_STEP) * GRIND_STEP) : s.grindSetting;
    const move = dir === 1 ? 'finer' : dir === -1 ? 'coarser' : '';
    const reason = [move, why].filter(Boolean).join(', ');
    // "Keep" needs no button: the form already starts from the last shot's grind.
    return { text: `Last: ${esc(what)} → ${dir ? 'try' : 'keep'} <b>${fmt(grind)}</b>${reason ? ` (${reason})` : ''}`, grind: dir ? grind : null };
  };
  const sour = t.has('sour') || t.has('watery');
  const bitter = t.has('bitter');
  if (t.has('channeling') || (sour && bitter)) {
    return { text: `Last: ${esc(what)} → fix puck prep (distribution, tamp) before changing the grind`, grind: null };
  }
  if (sour) return say(1, 'under-extracted');
  if (bitter) return say(-1, 'over-extracted');
  if (t.has('balanced') || t.has('sweet') || t.has('syrupy')) return say(0, 'it tasted good');
  if (s.timeSeconds < TARGET_TIME[0]) return say(1, 'it ran fast');
  if (s.timeSeconds > TARGET_TIME[1]) return say(-1, 'it ran slow');
  return say(0, 'time on target');
}

function renderGuide(bean, last) {
  const lines = [];
  if (!state.editingId) {
    const best = bean?.bestShot;
    if (best) lines.push({ cls: 'best', label: 'Best recipe', text: recipe(best), apply: best });
    const hint = last && dialHint(last);
    if (hint) lines.push({ label: 'Next shot', text: hint.text, apply: hint.grind != null ? { grindSetting: hint.grind } : null });
  }
  const guide = $('#guide');
  guide.hidden = lines.length === 0;
  guide.innerHTML = lines.map((l, i) => `
    <div class="line ${l.cls ?? ''}">
      <div class="text"><span class="label">${l.label}</span>${l.text}</div>
      ${l.apply ? `<button type="button" data-i="${i}">Use</button>` : ''}
    </div>`).join('');
  guide.querySelectorAll('button').forEach((btn) => btn.addEventListener('click', () => {
    const r = lines[Number(btn.dataset.i)].apply;
    $('#grind').value = fmt(r.grindSetting);
    if (r.doseGrams != null) $('#dose').value = fmt(r.doseGrams);
    if (r.yieldGrams != null) $('#yield').value = fmt(r.yieldGrams);
    ['#grind', '#dose', '#yield'].forEach((sel) => $(sel).classList.remove('invalid'));
    btn.textContent = 'Using ✓';
  }));
}

// ---------- charts ----------

const PALETTE = ['#a0612f', '#2f7ea0', '#5a9a3c', '#b0417a', '#c9a227', '#6b5bb5', '#3c9a8f', '#d0663a'];

function chartColors() {
  const css = getComputedStyle(document.documentElement);
  return { text: css.getPropertyValue('--muted').trim(), grid: css.getPropertyValue('--border').trim() };
}

function baseOptions(xTitle, yTitle) {
  const c = chartColors();
  const axis = (title) => ({
    title: { display: true, text: title, color: c.text },
    ticks: { color: c.text },
    grid: { color: c.grid },
  });
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    scales: { x: axis(xTitle), y: axis(yTitle) },
    plugins: { legend: { labels: { color: c.text, boxWidth: 12 } } },
  };
}

function drawChart(id, config) {
  state.charts[id]?.destroy();
  state.charts[id] = new Chart($('#' + id), config);
}

function renderCharts() {
  if (!$('#tab-charts').classList.contains('active') || typeof Chart === 'undefined') return;
  const filter = Number($('#chart-filter').value) || null;
  const shots = state.shots.filter((s) => !filter || s.beanId === filter).slice().reverse(); // oldest first
  $('#chart-empty').hidden = shots.length > 0;
  document.querySelectorAll('#tab-charts .chart').forEach((f) => { f.hidden = shots.length === 0; });
  if (!shots.length) return;

  const colorOf = (beanId) => PALETTE[Math.max(0, beanId - 1) % PALETTE.length];
  const groups = [...new Map(shots.map((s) => [s.beanId, s.beanName])).entries()];
  const label = (s) => `${formatDate(s.createdAt)} · ${s.beanName}`;

  // Time vs grind, one series per bean
  drawChart('c-grind', {
    type: 'scatter',
    data: {
      datasets: groups.map(([id, name]) => ({
        label: name,
        data: shots.filter((s) => s.beanId === id).map((s) => ({ x: s.grindSetting, y: s.timeSeconds, s })),
        backgroundColor: colorOf(id),
        pointRadius: 5,
      })),
    },
    options: {
      ...baseOptions('Grind setting', 'Time (s)'),
      plugins: {
        ...baseOptions().plugins,
        tooltip: { callbacks: { label: (ctx) => `${label(ctx.raw.s)}: grind ${fmt(ctx.raw.x)}, ${ctx.raw.y}s` } },
      },
    },
  });

  // Time per shot (chronological), points coloured by bean
  const seq = shots.map((s, i) => ({ x: i + 1, y: s.timeSeconds, s }));
  const timeOptions = baseOptions('Shot #', 'Time (s)');
  timeOptions.scales.x.type = 'linear';
  timeOptions.scales.x.ticks.precision = 0;
  timeOptions.plugins = {
    legend: { display: false },
    tooltip: { callbacks: { label: (ctx) => `${label(ctx.raw.s)}: ${ctx.raw.y}s, grind ${fmt(ctx.raw.s.grindSetting)}` } },
  };
  drawChart('c-time', {
    type: 'line',
    data: {
      datasets: [{
        label: 'Time (s)',
        data: seq,
        borderColor: chartColors().grid,
        pointBackgroundColor: seq.map((p) => colorOf(p.s.beanId)),
        pointBorderColor: seq.map((p) => colorOf(p.s.beanId)),
        pointRadius: 4,
        tension: 0,
      }],
    },
    options: timeOptions,
  });

  // Ratio over time (only shots with yield)
  const withYield = shots.filter((s) => s.yieldGrams != null);
  $('#c-ratio').closest('.chart').hidden = withYield.length === 0;
  if (withYield.length) {
    drawChart('c-ratio', {
      type: 'scatter',
      data: {
        datasets: groups.map(([id, name]) => ({
          label: name,
          data: withYield.filter((s) => s.beanId === id)
            .map((s) => ({ x: s.timeSeconds, y: +(s.yieldGrams / s.doseGrams).toFixed(2), s })),
          backgroundColor: colorOf(id),
          pointRadius: 5,
        })).filter((d) => d.data.length),
      },
      options: {
        ...baseOptions('Time (s)', 'Ratio (1:x)'),
        plugins: {
          ...baseOptions().plugins,
          tooltip: { callbacks: { label: (ctx) => `${label(ctx.raw.s)}: 1:${ctx.raw.y} in ${ctx.raw.x}s` } },
        },
      },
    });
  }
}

function renderAll() {
  renderBeanSelect();
  renderBeans();
  renderFilters();
  renderHistory();
  renderRecent();
  renderCharts();
}

// ---------- tabs ----------

function currentTab() {
  return document.querySelector('.tab.active').id.replace('tab-', '');
}

function updateTitle() {
  const titles = {
    log: state.editingId ? 'Edit shot' : 'New shot',
    beans: state.editingBeanId ? 'Edit beans' : $('#bean-form').hidden ? 'Beans' : 'New beans',
    history: 'History',
    charts: 'Charts',
  };
  $('#page-title').textContent = titles[currentTab()];
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + name));
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  updateTitle();
  if (name === 'charts') renderCharts();
}

// ---------- steppers ----------

function bindSteppers() {
  document.querySelectorAll('.stepper').forEach((el) => {
    const step = Number(el.dataset.step);
    const input = el.querySelector('input');
    const decimals = (String(step).split('.')[1] ?? '').length;
    const bump = (dir) => {
      const current = num(input.value);
      const base = current == null || Number.isNaN(current) ? 0 : current;
      const next = Math.max(0, Math.round((base + dir * step) / step) * step);
      input.value = next.toFixed(decimals).replace(/\.0+$/, '');
      input.classList.remove('invalid');
    };
    el.querySelector('.dec').addEventListener('click', () => bump(-1));
    el.querySelector('.inc').addEventListener('click', () => bump(1));
  });
}

// ---------- init ----------

function init() {
  bindSteppers();
  $('#shot-form').addEventListener('submit', onSubmit);
  $('#bean').addEventListener('change', () => { if (!state.editingId) applyGrindDefault(); renderRecent(); });
  $('#cancel-edit').addEventListener('click', () => { endEdit(); switchTab('history'); });
  $('#delete').addEventListener('click', onDelete);
  bindRating('#rating', () => state.rating, setRating);
  $('#tags').addEventListener('click', (e) => { if (e.target.dataset?.tag) toggleTag(e.target.dataset.tag); });

  $('#bean-form').addEventListener('submit', onBeanSubmit);
  $('#b-photo-input').addEventListener('change', onPhotoPicked);
  $('#b-photo-remove').addEventListener('click', onPhotoRemove);
  $('#bean-form').addEventListener('input', (e) => e.target.classList.remove('invalid'));
  bindPickers();
  $('#add-bean').addEventListener('click', () => openBeanForm(null));
  $('#bean-back').addEventListener('click', closeBeanForm);
  $('#bean-delete').addEventListener('click', onBeanDelete);
  bindRating('#b-rating', () => state.beanRating, setBeanRating);
  document.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => {
    switchTab(b.dataset.goto);
    if (b.dataset.goto === 'beans') openBeanForm(null);
  }));

  $('#history-filter').addEventListener('change', renderHistory);
  $('#chart-filter').addEventListener('change', renderCharts);
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.tab === 'beans' && currentTab() === 'beans') closeBeanForm();
    switchTab(b.dataset.tab);
  }));
  // Reloading goes through the login page and back; queued shots wait in localStorage.
  $('#status').addEventListener('click', () => { if (state.signedOut) location.reload(); });
  window.addEventListener('online', flushQueue);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) flushQueue(); });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderCharts);

  const initial = location.hash.slice(1);
  if (TABS.includes(initial)) switchTab(initial);

  updateStatus();
  refresh()
    .then(prefillNew)
    .then(flushQueue)
    .catch((e) => showError(e.message));

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
}

init();
