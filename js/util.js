/* Shared helpers: DOM, storage, toasts, modals, context menus, sound. */
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = (n = 10) => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const randInt = n => crypto.getRandomValues(new Uint32Array(1))[0] % n;
function shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = randInt(i + 1); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
const deepClone = o => JSON.parse(JSON.stringify(o));

/** Create an element: h('div.cls#id', {attrs}, children...) */
function h(tag, attrs, ...kids) {
  const m = tag.match(/^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i);
  const el = document.createElement(m[1] || 'div');
  (m[2].match(/[.#][\w-]+/g) || []).forEach(t => t[0] === '.' ? el.classList.add(t.slice(1)) : (el.id = t.slice(1)));
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(k));
  return el;
}

const Store = {
  get(key, fallback) {
    try { const v = localStorage.getItem('void.' + key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, val) { try { localStorage.setItem('void.' + key, JSON.stringify(val)); } catch { /* storage unavailable */ } },
  del(key) { try { localStorage.removeItem('void.' + key); } catch {} },
};

/* ---------------- toasts & screen reader ---------------- */
function toast(msg, type = '', ms = 3200, action) {
  const t = h('div.toast' + (type ? '.' + type : ''), { role: 'status' }, msg);
  if (action) t.append(h('button.btn.small', { onclick: () => { action.fn(); t.remove(); } }, action.label));
  $('#toast-root').append(t);
  setTimeout(() => t.remove(), ms);
}
function announce(msg) {
  if (!Settings?.get('srAnnounce')) return;
  const el = $('#sr-live'); el.textContent = ''; setTimeout(() => (el.textContent = msg), 30);
}

/* ---------------- modal ---------------- */
const Modal = {
  stack: [],
  open({ title, body, foot, size = '', onClose, nonblocking = false, id }) {
    if (id) { const ex = this.stack.find(m => m.id === id); if (ex) this.close(ex); }
    const back = h('div.modal-back' + (nonblocking ? '.nonblocking' : ''));
    const closeBtn = h('button.icon-btn', { 'aria-label': 'Close', title: 'Close (Esc)' }, '✕');
    const modal = h('div.modal' + (size ? '.' + size : ''), { role: 'dialog', 'aria-modal': nonblocking ? 'false' : 'true', 'aria-label': title },
      h('div.modal-head', null, h('h2', null, title), closeBtn),
      h('div.modal-body', null, body));
    if (foot) modal.append(h('div.modal-foot', null, foot));
    back.append(modal);
    const entry = { back, modal, onClose, id, prevFocus: document.activeElement };
    closeBtn.onclick = () => this.close(entry);
    back.addEventListener('mousedown', e => { if (e.target === back) this.close(entry); });
    $('#modal-root').append(back);
    this.stack.push(entry);
    setTimeout(() => (modal.querySelector('[autofocus]') || modal.querySelector('input,select,textarea,button:not(.icon-btn)') || closeBtn).focus(), 20);
    entry.close = () => this.close(entry);
    return entry;
  },
  close(entry = this.stack[this.stack.length - 1]) {
    if (!entry) return;
    entry.back.remove();
    this.stack = this.stack.filter(e => e !== entry);
    entry.onClose?.();
    entry.prevFocus?.focus?.();
  },
  isOpen() { return this.stack.length > 0; },
  confirm(title, text, okLabel = 'OK', danger = false) {
    return new Promise(res => {
      let done = false;
      const m = this.open({
        title, size: 'narrow', body: h('p', null, text),
        foot: [h('button.btn.ghost', { onclick: () => { done = true; m.close(); res(false); } }, 'Cancel'),
          h('button.btn' + (danger ? '.danger' : '.primary'), { autofocus: true, onclick: () => { done = true; m.close(); res(true); } }, okLabel)],
        onClose: () => { if (!done) res(false); },
      });
    });
  },
  prompt(title, label, value = '', type = 'text') {
    return new Promise(res => {
      let done = false;
      const input = h('input', { type, value, autofocus: true, style: { width: '100%' } });
      const ok = () => { done = true; m.close(); res(input.value); };
      input.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); });
      const m = this.open({
        title, size: 'narrow', body: h('label.field', null, h('span', null, label), input),
        foot: [h('button.btn.ghost', { onclick: () => m.close() }, 'Cancel'), h('button.btn.primary', { onclick: ok }, 'OK')],
        onClose: () => { if (!done) res(null); },
      });
      setTimeout(() => input.select(), 30);
    });
  },
  async number(title, label, value = 1) {
    const v = await this.prompt(title, label, String(value), 'number');
    if (v == null || v === '') return null;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  },
};

/* ---------------- context menu ----------------
   items: [{label, action, kb, icon, disabled, sub:[...]} | '-' | {title}]  */
const Menu = {
  open: [],
  show(x, y, items, title) {
    this.closeAll();
    this._build(x, y, items, title, 0);
  },
  _build(x, y, items, title, depth, parentBtn) {
    const el = h('div.ctx', { role: 'menu' });
    if (title) el.append(h('div.ctx-title', null, title));
    const buttons = [];
    for (const it of items) {
      if (!it) continue;
      if (it === '-') { el.append(h('hr')); continue; }
      if (it.title) { el.append(h('div.ctx-title', null, it.title)); continue; }
      const btn = h('button', { role: 'menuitem', disabled: it.disabled, 'aria-haspopup': it.sub ? 'menu' : null },
        h('span.ic', { 'aria-hidden': 'true' }, it.icon || ''), h('span', null, it.label),
        it.sub ? h('span.sub', { 'aria-hidden': 'true' }, '▸') : (it.kb ? h('span.kb', null, it.kb) : null));
      if (it.sub) {
        const openSub = () => {
          if (btn.classList.contains('open')) return;
          this.open.slice(depth + 1).forEach(m => m.remove());
          this.open.length = depth + 1;
          $$('button.open', el).forEach(b => b.classList.remove('open'));
          btn.classList.add('open');
          const r = btn.getBoundingClientRect();
          this._build(r.right - 4, r.top - 4, typeof it.sub === 'function' ? it.sub() : it.sub, null, depth + 1, btn);
        };
        btn.addEventListener('mouseenter', openSub);
        btn.addEventListener('click', e => { e.stopPropagation(); openSub(); this.open[depth + 1]?.querySelector('button')?.focus(); });
      } else {
        btn.addEventListener('mouseenter', () => {
          this.open.slice(depth + 1).forEach(m => m.remove()); this.open.length = depth + 1;
          $$('button.open', el).forEach(b => b.classList.remove('open'));
        });
        btn.addEventListener('click', e => { e.stopPropagation(); this.closeAll(); it.action?.(); });
      }
      buttons.push(btn); el.append(btn);
    }
    el.addEventListener('keydown', e => {
      const i = buttons.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); buttons[(i + 1) % buttons.length]?.focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); buttons[(i - 1 + buttons.length) % buttons.length]?.focus(); }
      else if (e.key === 'ArrowRight' && document.activeElement?.getAttribute('aria-haspopup')) { document.activeElement.click(); }
      else if (e.key === 'ArrowLeft' && depth > 0) { e.preventDefault(); el.remove(); this.open.length = depth; parentBtn?.classList.remove('open'); parentBtn?.focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); this.closeAll(); }
    });
    el.addEventListener('contextmenu', e => e.preventDefault());
    $('#menu-root').append(el);
    const r = el.getBoundingClientRect();
    let left = x, top = y;
    if (left + r.width > innerWidth - 4) left = depth > 0 && parentBtn ? parentBtn.getBoundingClientRect().left - r.width + 4 : innerWidth - r.width - 4;
    if (top + r.height > innerHeight - 4) top = Math.max(4, innerHeight - r.height - 4);
    el.style.left = Math.max(4, left) + 'px'; el.style.top = top + 'px';
    this.open.push(el);
    if (depth === 0) setTimeout(() => buttons[0]?.focus({ preventScroll: true }), 0);
    return el;
  },
  closeAll() { this.open.forEach(m => m.remove()); this.open = []; },
  isOpen() { return this.open.length > 0; },
};
document.addEventListener('mousedown', e => { if (!e.target.closest('.ctx')) Menu.closeAll(); });
// Global Escape: close the top-most menu, else the top-most modal (arrows get first claim in board.js).
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || (typeof Board !== 'undefined' && Board.arrowing)) return;
  if (Menu.isOpen()) { Menu.closeAll(); e.voidHandled = true; }
  else if (Modal.isOpen()) { Modal.close(); e.voidHandled = true; }
});
window.addEventListener('blur', () => Menu.closeAll());

/* ---------------- collapsible sections (state remembered) ---------------- */
function initCollapsibles(root = document) {
  const saved = Store.get('collapsed', {});
  $$('.collapsible[data-collapse-key]', root).forEach(sec => {
    if (sec.dataset.cinit) return; sec.dataset.cinit = 1;
    const key = sec.dataset.collapseKey;
    if (saved[key]) sec.classList.add('collapsed');
    const head = $('.panel-head', sec), btn = $('.collapse-btn', sec);
    const sync = () => btn?.setAttribute('aria-expanded', String(!sec.classList.contains('collapsed')));
    sync();
    head?.addEventListener('click', e => {
      if (e.target.closest('input,select,a') || (e.target.closest('button') && e.target.closest('button') !== btn)) return;
      sec.classList.toggle('collapsed');
      const s = Store.get('collapsed', {}); s[key] = sec.classList.contains('collapsed'); Store.set('collapsed', s);
      sync();
    });
  });
}

/* ---------------- sound (synthesised, no assets) ---------------- */
const Sound = {
  ctx: null,
  play(kind) {
    if (!Settings.get('sound')) return;
    try {
      this.ctx ||= new (window.AudioContext || window.webkitAudioContext)();
      const presets = { draw: [520, 'sine', .07], tap: [240, 'triangle', .05], shuffle: [160, 'sawtooth', .18], turn: [660, 'sine', .25], drop: [330, 'sine', .05], life: [440, 'square', .04], chat: [880, 'sine', .08], arrow: [300, 'triangle', .1], join: [720, 'sine', .2] };
      const [f, type, dur] = presets[kind] || presets.drop;
      const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t);
      if (kind === 'shuffle') o.frequency.exponentialRampToValueAtTime(80, t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.08 * Settings.get('volume'), t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.ctx.destination); o.start(t); o.stop(t + dur + .02);
    } catch {}
  },
};

/* mana cost -> icons using Scryfall's SVG symbology */
function manaHTML(cost) {
  if (!cost) return '';
  return '<span class="mana">' + cost.split(' // ').map(part => (part.match(/\{[^}]+\}/g) || []).map(sym => {
    const code = sym.slice(1, -1).replace(/\//g, '');
    return `<img src="https://svgs.scryfall.io/card-symbols/${encodeURIComponent(code)}.svg" alt="${esc(sym)}" loading="lazy">`;
  }).join('')).join('<span class="muted">&nbsp;//&nbsp;</span>') + '</span>';
}
function copyText(t) {
  return navigator.clipboard?.writeText(t).then(() => toast('Copied to clipboard', 'ok'), () => fallbackCopy(t)) ?? fallbackCopy(t);
}
function fallbackCopy(t) {
  const ta = h('textarea', { style: { position: 'fixed', opacity: 0 } }); ta.value = t; document.body.append(ta); ta.select();
  try { document.execCommand('copy'); toast('Copied to clipboard', 'ok'); } catch { toast('Copy failed — select and copy manually', 'err'); }
  ta.remove();
}
function downloadText(name, text) {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/plain' })), download: name });
  document.body.append(a); a.click(); a.remove();
}
const isTyping = e => { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); };
