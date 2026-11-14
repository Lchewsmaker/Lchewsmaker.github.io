/* Table rendering & interaction: boards, hand, drag-and-drop, context menus, arrows, preview, keyboard. */
'use strict';

/* ======================= Card preview ======================= */
const Preview = {
  el: null, img: null, txt: null, cur: null, altHeld: false, lastXY: [0, 0],
  init() { this.el = $('#preview'); this.img = $('img', this.el); this.txt = $('.preview-text', this.el); this.img.onload = () => this.move(...this.lastXY); },
  bind(el, get) {
    el.dataset.previewBound = '1';
    el.addEventListener('mouseenter', e => this.show(get(), e.clientX, e.clientY));
    el.addEventListener('mousemove', e => this.move(e.clientX, e.clientY));
    el.addEventListener('mouseleave', () => this.hide());
  },
  show(card, x, y, { back = false, note = '' } = {}) {
    const mode = Settings.get('preview');
    this.cur = { card, back, note }; this.lastXY = [x, y];
    if (!card || mode === 'off' || (mode === 'alt' && !this.altHeld) || document.body.classList.contains('dragging')) { this.el.classList.remove('show'); return; }
    const src = back && card.backL ? card.backL : (card.imgL || card.img);
    if (!src) { this.el.classList.remove('show'); return; }
    if (this.img.getAttribute('src') !== src) this.img.src = src;
    this.img.alt = card.name;
    this.txt.textContent = [note, card.name + (card.mana ? '  ' + card.mana : ''), card.type, card.text, card.pt || (card.loy ? 'Loyalty ' + card.loy : '')].filter(Boolean).join('\n');
    this.el.classList.add('show');
    this.move(x, y);
  },
  move(x, y) {
    this.lastXY = [x, y];
    if (!this.el.classList.contains('show')) return;
    const pos = Settings.get('previewPos');
    this.el.classList.toggle('pos-right', pos === 'right'); this.el.classList.toggle('pos-left', pos === 'left');
    if (pos !== 'cursor') { this.el.style.left = this.el.style.top = ''; return; }
    const w = this.el.offsetWidth, hgt = this.el.offsetHeight;
    let left = x + 24, top = y - hgt / 2;
    if (left + w > innerWidth - 8) left = x - w - 24;
    top = clamp(top, 8, innerHeight - hgt - 8);
    this.el.style.left = left + 'px'; this.el.style.top = top + 'px';
  },
  hide() { this.cur = null; this.el.classList.remove('show'); },
  refresh() { if (this.cur) this.show(this.cur.card, ...this.lastXY, this.cur); },
};

/* ======================= Board ======================= */
const Board = {
  cells: {},          // pid -> {cell, board, head, piles, field, s, ox, oy, mirror}
  sel: new Set(),
  hover: null,        // card element under cursor
  mouse: { x: 0, y: 0 },
  spot: null,         // spotlight opponent pid
  viewers: [],
  arrowing: null,
  bound: false,
  ro: null,
  logFilter: 'all',

  setup() {
    if (!this.bound) { this.bindOnce(); this.bound = true; }
    this.sel.clear(); this.viewers = [];
    $('#g-log').replaceChildren();
    $('#tab-game').hidden = false;
    this.spot = Game.others()[0] || null;
    this.layout();
    this.renderPhases(); this.renderTurn(); this.renderSide(); this.renderHand();
    $('#g-cmd-sec').hidden = !Game.M.cmdDamage;
    $('#g-match-sec').hidden = !Game.M.match;
    if (Store.get('g.sideHidden')) $('#g-side').classList.add('hidden');
    $('#hand-dock').classList.toggle('collapsed', !!Store.get('g.handCollapsed'));
    this.startLoops();
  },
  teardown() {
    $('#tab-game').hidden = true; $('#g-table').replaceChildren(); this.cells = {};
    this.viewers.forEach(v => v.modal.close()); this.viewers = [];
    $('#arrow-layer').innerHTML = '';
  },

  /* ---------------- layout ---------------- */
  layout() {
    const t = $('#g-table');
    this.ro?.disconnect();
    this.ro = new ResizeObserver(() => this.fitAll());
    t.replaceChildren(); t.removeAttribute('style'); this.cells = {};
    const view = Settings.get('boardView'), opps = Game.others();
    t.className = 'g-table view-' + view + (opps.length ? '' : ' solo');
    const mk = pid => { const c = this.buildCell(pid); this.ro.observe(c.cell); return c.cell; };
    if (!opps.length) { t.append(mk(Game.me)); }
    else if (view === 'grid') { opps.forEach(p => t.append(mk(p))); t.append(mk(Game.me)); this.ro.observe(t); }
    else if (view === 'spotlight') {
      if (!opps.includes(this.spot)) this.spot = opps[0];
      const tabs = h('div.spot-tabs', { role: 'tablist', 'aria-label': 'Opponent' }, opps.map(p => {
        const b = h('button', { role: 'tab', class: p === this.spot ? 'on' : '', 'aria-selected': String(p === this.spot), style: { borderLeft: `4px solid ${Game.color(p)}` } }, Game.name(p));
        b.onclick = () => { this.spot = p; this.layout(); }; return b;
      }));
      t.append(tabs);
      opps.forEach(p => { const c = mk(p); if (p !== this.spot) c.classList.add('spot-hidden'); t.append(c); });
      t.append(mk(Game.me));
    } else {
      const row = h('div.opps'); opps.forEach(p => row.append(mk(p))); t.append(row, mk(Game.me)); this.ro.observe(row);
    }
    this.updateAll();
    requestAnimationFrame(() => this.fitAll());
  },

  fitGrid(container, n, gap = 6) {
    const W = container.clientWidth, H = container.clientHeight;
    let best = 1, bestS = 0;
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols), s = Math.min((W - gap * (cols - 1)) / cols / BW, (H - gap * (rows - 1)) / rows / BH);
      if (s > bestS) { bestS = s; best = cols; }
    }
    container.style.gridTemplateColumns = `repeat(${best}, minmax(0,1fr))`;
    container.style.gridAutoFlow = 'row';
    container.style.gridAutoColumns = 'auto';
  },

  fitAll() {
    const t = $('#g-table'), view = Settings.get('boardView');
    if (view === 'grid' && Object.keys(this.cells).length > 1) this.fitGrid(t, Object.keys(this.cells).length);
    const row = $('.opps', t); if (row) this.fitGrid(row, row.children.length);
    for (const [pid, c] of Object.entries(this.cells)) {
      const w = c.cell.clientWidth, hh = c.cell.clientHeight; if (!w || !hh) continue;
      const s = Math.min(w / BW, hh / BH), ox = (w - BW * s) / 2, oy = (hh - BH * s) / 2;
      c.s = s; c.ox = ox; c.oy = oy;
      c.mirror = pid !== Game.me && Settings.get('mirrorOpps');
      c.board.style.transform = c.mirror ? `translate(${ox + BW * s}px, ${oy + BH * s}px) scale(${s}) rotate(180deg)` : `translate(${ox}px, ${oy}px) scale(${s})`;
    }
  },

  buildCell(pid) {
    const mine = pid === Game.me;
    const cell = h('div.board-cell', { dataset: { pid } });
    const board = h('div.board', { dataset: { pid }, role: 'region', 'aria-label': `${Game.name(pid)}'s battlefield` });
    const felt = h('div.felt');
    const head = h('div.b-head', { dataset: { pid } },
      h('span.pname', null, h('i', { style: { '--pat': Settings.playerPattern(Game.info[pid]?.color) } }), h('span.nm')),
      h('div.life', { role: 'group', 'aria-label': 'Life' },
        mine ? h('button', { 'aria-label': 'Lose 1 life', title: 'Lose 1 (−) · Shift: 5', onclick: e => Game.setLife(e.shiftKey ? -5 : -1) }, '−') : null,
        h('b', { 'aria-live': 'polite' }, ''),
        mine ? h('button', { 'aria-label': 'Gain 1 life', title: 'Gain 1 (+) · Shift: 5', onclick: e => Game.setLife(e.shiftKey ? 5 : 1) }, '+') : null),
      h('div.stats.row.gap'), h('div.hbadges'));
    const piles = h('div.piles');
    for (const z of ['library', 'graveyard', 'exile', 'command']) piles.append(h('div.pile.zone', { dataset: { zone: z, pid }, tabindex: 0, role: 'button', 'aria-label': `${Game.name(pid)}'s ${ZONE_LABEL[z]}` }));
    const field = h('div.battlefield.zone', { dataset: { zone: 'battlefield', pid } }, h('div.land-line'));
    board.append(felt, head, piles, field);
    cell.append(board);
    this.cells[pid] = { cell, board, head, piles, field, felt, s: 1, ox: 0, oy: 0, mirror: false };
    return this.cells[pid];
  },

  /* ---------------- per-board update ---------------- */
  updateAll() { Object.keys(this.cells).forEach(p => this.update(p)); if (Game.active) this.renderHand(); },

  update(pid) {
    if (!Game.active) return;
    const c = this.cells[pid];
    if (pid === Game.me) this.renderHand();
    cancelAnimationFrame(this._sideRaf); this._sideRaf = requestAnimationFrame(() => this.renderSide());
    this.viewers.filter(v => v.pid === pid).forEach(v => v.render());
    if (!c) return;
    const st = Game.state(pid);
    const mine = pid === Game.me;
    c.board.style.setProperty('--pc', Game.color(pid));
    c.board.classList.toggle('active-turn', Game.isActive(pid));
    if (!st) { $('.nm', c.head).textContent = Game.name(pid) + ' (connecting…)'; return; }
    c.board.classList.toggle('dead', !!st.dead);
    const playmat = mine && Settings.get('playmatUrl');
    c.felt.classList.toggle('custom', !!playmat);
    c.felt.style.backgroundImage = playmat ? `url("${playmat.replace(/["\\]/g, '')}")` : '';

    // header
    $('.nm', c.head).textContent = Game.name(pid) + (st.dead ? ' ☠' : '');
    $('.pname i', c.head).style.background = Game.color(pid);
    $('.life b', c.head).textContent = st.life;
    const poisonLethal = st.poison >= (Game.settings.poison || 10);
    const cmdLethal = Object.values(st.cmdDmg || {}).some(v => v >= (Game.settings.cmdLethal || 21));
    const stats = [];
    stats.push(`<span class="stat${st.hand ? ' clickable' : ''}" data-act="hand" title="Cards in hand${st.hand ? ' (revealed — click to view)' : ''}">✋ ${st.handCount}${st.hand ? ' 👁' : ''}</span>`);
    stats.push(`<span class="stat" title="Cards in library">📚 ${st.libCount}</span>`);
    if (st.poison || mine) stats.push(`<span class="stat${mine ? ' clickable' : ''}${poisonLethal ? ' warn' : ''}" data-act="poison" title="Poison counters${mine ? ' (click +1, right-click −1)' : ''}">☠ ${st.poison}</span>`);
    if (st.energy) stats.push(`<span class="stat${mine ? ' clickable' : ''}" data-act="energy" title="Energy">⚡ ${st.energy}</span>`);
    if (st.exp) stats.push(`<span class="stat${mine ? ' clickable' : ''}" data-act="exp" title="Experience">✦ ${st.exp}</span>`);
    if (st.rad) stats.push(`<span class="stat${mine ? ' clickable' : ''}" data-act="rad" title="Rad counters">☢ ${st.rad}</span>`);
    if (cmdLethal) stats.push(`<span class="stat warn" title="Lethal commander damage">⚔ lethal</span>`);
    if (!st.kept && Game.settings.mulligan !== 'none') stats.push(`<span class="stat" title="Still deciding on opening hand">mulligan${st.mulligans ? ' ×' + st.mulligans : ''}…</span>`);
    $('.stats', c.head).innerHTML = stats.join('');
    const badges = [];
    if (Game.global.monarch === pid) badges.push('<span class="hbadge" style="color:#ffd76a" title="The Monarch">👑 Monarch</span>');
    if (Game.global.initiative === pid) badges.push('<span class="hbadge" style="color:#9fd3ff" title="Has the initiative">🗝 Initiative</span>');
    if (Game.global.blessing?.[pid]) badges.push('<span class="hbadge" title="City\'s blessing">🏙</span>');
    if (Game.M.teams) badges.push(`<span class="hbadge">Team ${Game.team(pid) ? 'B' : 'A'}</span>`);
    if (Game.isActive(pid)) badges.push('<span class="hbadge" style="background:var(--pc);color:#000">▶ Turn</span>');
    if (st.dc) badges.push('<span class="hbadge dc">disconnected</span>');
    $('.hbadges', c.head).innerHTML = badges.join('');

    // piles
    for (const pile of $$('.pile', c.piles)) {
      const z = pile.dataset.zone;
      let list = z === 'library' ? null : (st[z] || []);
      const count = z === 'library' ? st.libCount : list.length;
      pile.hidden = z === 'command' && !Game.M.commander && !count;
      pile.classList.toggle('empty', !count);
      let topInst = null, showBack = false;
      if (z === 'library') { if (count) { topInst = mine ? Game.my.library[0] : (st.top ? st.top : { c: null }); showBack = !(st.top); } }
      else if (count) topInst = z === 'command' ? list[0] : list[list.length - 1];
      pile.replaceChildren(h('span.ptitle', null, { library: 'Library', graveyard: 'Graveyard', exile: 'Exile', command: 'Command' }[z]));
      if (topInst) {
        const el = this.cardEl(topInst, pid, z, { back: showBack });
        pile.append(el);
      }
      if (count) pile.append(h('span.pcount', null, count));
      pile.setAttribute('aria-label', `${Game.name(pid)}'s ${ZONE_LABEL[z]}: ${count} card${count === 1 ? '' : 's'}`);
    }

    // battlefield (keyed)
    const scale = Settings.get('cardScale');
    const keep = new Set();
    for (const inst of st.battlefield || []) {
      keep.add(inst.iid);
      let el = c.field.querySelector(`.card[data-iid="${inst.iid}"]`);
      if (!el) { el = this.cardEl(inst, pid, 'battlefield'); c.field.append(el); }
      else this.updateCardEl(el, inst, pid, 'battlefield');
      el.style.left = inst.x + 'px'; el.style.top = inst.y + 'px';
      el.style.width = CW * scale + 'px'; el.style.height = CH * scale + 'px';
      el.style.zIndex = inst.z || 1;
      el.classList.toggle('selected', mine && this.sel.has(inst.iid));
    }
    $$('.card', c.field).forEach(el => { if (!keep.has(el.dataset.iid)) el.remove(); });
    if (mine) for (const id of [...this.sel]) if (!keep.has(id)) this.sel.delete(id);
  },

  cardEl(inst, pid, zone, opts) {
    const el = h('div.card', { dataset: { iid: inst.iid || '', pid, zone } });
    this.updateCardEl(el, inst, pid, zone, opts);
    return el;
  },
  updateCardEl(el, inst, pid, zone, { back = false } = {}) {
    const mine = pid === Game.me;
    el._inst = inst; el._pid = pid;
    el.dataset.zone = zone;
    const c = inst.c;
    const hidden = back || !c || inst.faceDown;
    const src = hidden ? CARD_BACK : (inst.flipped && c.back ? c.back : c.img);
    el.style.backgroundImage = src ? `url("${src}")` : '';
    el.classList.toggle('noimg', !hidden && !src);
    el.classList.toggle('tapped', !!inst.tapped && zone === 'battlefield');
    el.classList.toggle('flip180', !!inst.flip180 && zone === 'battlefield');
    el.classList.toggle('face-down', hidden);
    el.classList.toggle('token-card', !!inst.token && zone === 'battlefield');
    el.classList.toggle('not-mine', !mine);
    el.classList.toggle('revealed', zone === 'hand' && !!inst.revealed);
    el.tabIndex = Settings.get('keyboardCards') && (zone === 'battlefield' || zone === 'hand') ? 0 : -1;
    const name = hidden ? (inst.faceDown && mine && c ? `${c.name} (face down)` : 'Face-down card') : (inst.flipped && c.faceNames?.[1]) || c.name;
    el.setAttribute('aria-label', `${name}${inst.tapped ? ', tapped' : ''}${Object.keys(inst.counters || {}).length ? ', counters ' + Object.entries(inst.counters).map(([k, v]) => v + ' ' + k).join(', ') : ''}`);
    let inner = `<span class="cname">${esc(hidden ? '' : name)}</span>`;
    const ctrs = Object.entries(inst.counters || {});
    if (ctrs.length && zone === 'battlefield') inner += `<div class="counters">${ctrs.map(([k, v]) => `<span class="counter ${k === '+1/+1' ? 'plus' : k === '-1/-1' ? 'minus' : k === 'loyalty' ? 'loyalty' : ''}" data-counter="${esc(k)}" title="${esc(k)} — click +1, right-click −1">${k === '+1/+1' ? '+' + v + '/+' + v : k === '-1/-1' ? '−' + v + '/−' + v : k === 'loyalty' ? '◆ ' + v : esc(k) + ' ' + v}</span>`).join('')}</div>`;
    if (zone === 'battlefield' && !hidden) {
      const base = (inst.flipped ? c.ptBack : c.pt) || '';
      const plus = (inst.counters?.['+1/+1'] || 0) - (inst.counters?.['-1/-1'] || 0);
      if (inst.pt) inner += `<span class="pt mod">${esc(inst.pt)}</span>`;
      else if (plus && /^\d+\/\d+$/.test(base)) { const [p, t] = base.split('/').map(Number); inner += `<span class="pt mod">${p + plus}/${t + plus}</span>`; }
      if (inst.note) inner += `<span class="note">${esc(inst.note)}</span>`;
      if (inst.dnu) inner += `<span class="dnu" title="Doesn't untap">⊘</span>`;
    }
    if (zone === 'command' && inst.casts) inner += `<span class="tax" title="Commander tax">+${inst.casts * 2}</span>`;
    if (el._html !== inner) { el.innerHTML = inner; el._html = inner; }
  },

  renderHand() {
    const hand = $('#hand'); if (!Game.active || !Game.my) return;
    const list = Game.my.hand;
    const keep = new Set(list.map(c => c.iid));
    $$('.card', hand).forEach(el => { if (!keep.has(el.dataset.iid)) el.remove(); });
    list.forEach((inst, i) => {
      let el = hand.querySelector(`.card[data-iid="${inst.iid}"]`);
      if (!el) el = this.cardEl(inst, Game.me, 'hand'); else this.updateCardEl(el, inst, Game.me, 'hand');
      if (hand.children[i] !== el) hand.insertBefore(el, hand.children[i] || null);
    });
    $('#hand-count').textContent = list.length;
    hand.classList.toggle('spread', Settings.get('handSpread'));
    const m = Game.my;
    const mb = $('#mull-bar');
    mb.hidden = m.kept;
    if (!m.kept) $('#mull-text').textContent = m.mulligans ? `Mulligans: ${m.mulligans}` : 'Opening hand';
    $('#hand-reveal').textContent = m.handRevealed ? 'Hide' : 'Reveal';
  },

  /* ---------------- toolbar / side ---------------- */
  renderPhases() {
    $('#g-phases').replaceChildren(...PHASES.map((p, i) => h('li', null, h('button', { dataset: { phase: i }, title: p, onclick: () => { if (Game.canAct()) Game.setPhase(i); else toast("It's not your turn"); } }, p))));
  },
  renderTurn() {
    $('#g-turn').textContent = Game.turn.n;
    const a = $('#g-active'); a.textContent = (Game.M.teams ? 'Team ' : '') + Game.name(Game.turn.active) + (Game.turn.active === Game.me ? ' (you)' : '');
    a.style.background = Game.color(Game.turn.active); a.style.color = '#000';
    $$('#g-phases button').forEach(b => b.classList.toggle('on', +b.dataset.phase === Game.turn.phase));
    const mine = Game.canAct();
    $('#g-pass').disabled = !mine; $('#g-next-phase').disabled = !mine;
    $('#g-clock').hidden = !Game.settings.timer;
    this.renderSide();
  },
  renderSide() {
    if (!Game.active) return;
    // players
    $('#g-players').replaceChildren(...Game.seating.map(pid => {
      const st = Game.state(pid) || {};
      const row = h('div.pl-row' + (Game.isActive(pid) ? '.active' : '') + (st.dead ? '.dead' : ''), { tabindex: 0, title: 'Click to spotlight · right-click for options' },
        h('span.dot', { style: { background: Game.color(pid), '--pat': Settings.playerPattern(Game.info[pid]?.color) } }),
        h('span.nm', null, Game.name(pid), pid === Game.me ? h('small', null, ' (you)') : null, h('div.badges', null,
          Game.global.monarch === pid ? h('span.badge.monarch', null, '👑') : null, Game.global.initiative === pid ? h('span.badge.init', null, '🗝') : null,
          st.poison ? h('span.badge', null, `☠${st.poison}`) : null, h('span.badge', { title: 'hand / library' }, `✋${st.handCount ?? '?'} 📚${st.libCount ?? '?'}`),
          Game.settings.timer ? h('span.badge', { dataset: { clock: pid } }, '') : null)),
        h('span.lf', null, st.life ?? '–'));
      row.onclick = () => { if (pid !== Game.me && Settings.get('boardView') === 'spotlight') { this.spot = pid; this.layout(); } else this.cells[pid]?.board.scrollIntoView?.({ block: 'nearest' }); };
      row.oncontextmenu = e => { e.preventDefault(); this.playerMenu(e, pid); };
      return row;
    }));
    // commander damage taken by me
    if (Game.M.cmdDamage) {
      const rows = [];
      for (const pid of Game.seating) {
        const st = Game.state(pid); if (!st) continue;
        for (const cm of st.commanders || []) {
          if (pid === Game.me && Game.seating.length > 1) continue;
          const key = `${pid}|${cm.iid}`, v = Game.my.cmdDmg[key] || 0;
          rows.push(h('div.cmd-row', null, h('img', { src: cm.art, alt: '' }),
            h('div.nm', null, cm.name, h('small', null, Game.name(pid))),
            h('div.stepper', null, h('button', { 'aria-label': 'Less damage', onclick: () => Game.cmdDamage(key, -1, cm.name) }, '−'),
              h('b' + (v >= Game.settings.cmdLethal ? '.lethal' : ''), null, v),
              h('button', { 'aria-label': 'More damage', onclick: () => Game.cmdDamage(key, 1, cm.name) }, '+'))));
        }
      }
      $('#g-cmd').replaceChildren(h('p.muted.small', { style: { margin: '0 0 .4rem' } }, `Damage you've taken (lethal at ${Game.settings.cmdLethal}).`), h('div.cmd-grid', null, rows.length ? rows : h('span.muted.small', null, 'No opposing commanders yet.')));
      // Others' damage summary
      const others = Game.others().map(pid => { const st = Game.state(pid); const tot = Object.entries(st?.cmdDmg || {}).filter(([k, v]) => v); return tot.length ? h('div.small.muted', null, `${Game.name(pid)}: ` + tot.map(([k, v]) => `${v} from ${(Game.state(k.split('|')[0])?.commanders || []).find(c => c.iid === k.split('|')[1])?.name || '?'}`).join(', ')) : null; }).filter(Boolean);
      if (others.length) $('#g-cmd').append(h('div', { style: { marginTop: '.5rem' } }, others));
    }
    // global table state
    const g = Game.global;
    const pick = (label, key) => h('button.btn.small' + (g[key] ? '.on' : ''), { onclick: e => this.pickPlayerMenu(e, label, pid => Game.setGlobal({ [key]: pid }) || Game.log(pid ? `${Game.name(pid)} ${key === 'monarch' ? 'became the monarch' : 'took the initiative'}.` : `${label} cleared.`)) }, `${label}${g[key] ? ': ' + Game.name(g[key]) : ''}`);
    $('#g-global').replaceChildren(h('div.toggles', null,
      Game.M.monarch || Game.seating.length > 2 ? pick('👑 Monarch', 'monarch') : pick('👑 Monarch', 'monarch'),
      pick('🗝 Initiative', 'initiative'),
      h('button.btn.small' + (g.day ? '.on' : ''), { title: 'Day / Night', onclick: () => { const n = g.day === 'day' ? 'night' : g.day === 'night' ? null : 'day'; Game.setGlobal({ day: n }); Game.log(n ? `It is now ${n}.` : 'Day/night tracking cleared.'); } }, g.day === 'night' ? '🌙 Night' : g.day === 'day' ? '☀ Day' : '☀/🌙'),
      h('button.btn.small' + (g.blessing?.[Game.me] ? '.on' : ''), { title: "City's blessing", onclick: () => { Game.setGlobal({ blessing: { ...g.blessing, [Game.me]: !g.blessing?.[Game.me] } }); } }, "🏙 Blessing")),
      h('div.toggles', { style: { marginTop: '.4rem' } },
        ...[6, 20].map(n => h('button.btn.small', { onclick: () => Game.roll(n) }, `🎲 d${n}`)),
        h('button.btn.small', { onclick: e => this.diceMenu(e) }, '🎲 …'),
        h('button.btn.small', { onclick: () => Game.flipCoin() }, '🪙 Coin')));
    // match
    if (Game.M.match) {
      $('#g-match').replaceChildren(h('div.muted.small', null, `Game ${Game.match.game} · best of three`),
        ...Game.seating.map(pid => h('div.pl-row', null, h('span.dot', { style: { background: Game.color(pid) } }), h('span.nm', null, Game.name(pid)),
          h('div.stepper', null, h('button', { 'aria-label': 'Remove win', onclick: () => this.setWin(pid, -1) }, '−'), h('b', null, Game.match.wins[pid] || 0), h('button', { 'aria-label': 'Add win', onclick: () => this.setWin(pid, 1) }, '+')))),
        h('button.btn.small', { style: { marginTop: '.4rem' }, onclick: () => Game.sideboardModal() }, 'Sideboard & next game'));
    }
  },
  setWin(pid, d) {
    Game.match.wins[pid] = Math.max(0, (Game.match.wins[pid] || 0) + d);
    Net.broadcast('match', { match: Game.match }); this.renderSide();
    if (d > 0) Game.log(`${Game.name(pid)} won game ${Game.match.game}.`);
  },

  addLog(text, kind) {
    const ts = Settings.get('logTimestamps') ? new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const li = h('li' + (kind === 'chat' ? '.chat' : ''), null, ts ? h('span.t', null, ts) : null);
    if (kind === 'chat') { const i = text.indexOf(': '); li.append(h('b', null, text.slice(0, i + 1)), ' ' + text.slice(i + 2)); }
    else li.append(text);
    const log = $('#g-log'); const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    log.append(li); if (log.children.length > 600) log.firstChild.remove();
    if (atBottom) log.scrollTop = log.scrollHeight;
  },

  /* ======================= events ======================= */
  bindOnce() {
    const game = $('#view-game');
    $('#g-next-phase').onclick = () => Game.nextPhase();
    $('#g-pass').onclick = () => Game.passTurn();
    $('#g-tools-btn').onclick = e => { const r = e.currentTarget.getBoundingClientRect(); Menu.show(r.left, r.bottom + 4, this.toolsMenu(), 'Tools'); };
    $('#g-view-btn').onclick = e => { const r = e.currentTarget.getBoundingClientRect(); Menu.show(r.left, r.bottom + 4, this.viewMenu(), 'Board view'); };
    $('#g-side-toggle').onclick = () => { $('#g-side').classList.toggle('hidden'); Store.set('g.sideHidden', $('#g-side').classList.contains('hidden')); requestAnimationFrame(() => this.fitAll()); };
    $('#hand-collapse').onclick = () => { $('#hand-dock').classList.toggle('collapsed'); Store.set('g.handCollapsed', $('#hand-dock').classList.contains('collapsed')); requestAnimationFrame(() => this.fitAll()); };
    $('#hand-sort').onclick = () => { Game.pushUndo(); Game.my.hand.sort((a, b) => (primaryType(a.c.type) === 'Land') - (primaryType(b.c.type) === 'Land') || a.c.cmc - b.c.cmc || a.c.name.localeCompare(b.c.name)); Game.sync(); };
    $('#hand-reveal').onclick = () => Game.revealHand();
    $('#btn-keep').onclick = () => Game.keep();
    $('#btn-mull').onclick = () => Game.mulligan();
    $('#g-chat-form').onsubmit = e => { e.preventDefault(); Game.chat($('#g-chat').value); $('#g-chat').value = ''; };
    $$('[data-logf]').forEach(b => b.onclick = () => { $$('[data-logf]').forEach(x => x.classList.toggle('active', x === b)); $('#g-log').className = 'log f-' + b.dataset.logf; });

    document.addEventListener('pointerdown', e => this.onPointerDown(e));
    document.addEventListener('pointermove', e => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; });
    document.addEventListener('mouseover', e => this.onOver(e));
    document.addEventListener('contextmenu', e => this.onContext(e));
    document.addEventListener('dblclick', e => this.onDbl(e));
    document.addEventListener('click', e => this.onClick(e), true);
    document.addEventListener('keydown', e => this.onKey(e));
    document.addEventListener('keyup', e => this.onKeyUp(e));
    window.addEventListener('resize', () => this.fitAll());
    Settings.onChange(k => {
      if (!Game.active) return;
      if (['boardView', 'mirrorOpps', '*', 'colorblind'].includes(k)) this.layout();
      else if (['cardScale', 'handSpread', 'playmatUrl', 'keyboardCards', 'showNames'].includes(k)) this.updateAll();
      if (k === 'handSize' || k === 'uiScale') requestAnimationFrame(() => this.fitAll());
    });
    $('#hand').addEventListener('keydown', e => this.cardKey(e));
    $('#g-table').addEventListener('keydown', e => this.cardKey(e));
  },

  active() { return Game.active && $('#view-game').classList.contains('active'); },

  cardFromEl(el) { return el ? { iid: el.dataset.iid, pid: el.dataset.pid || el._pid, zone: el.dataset.zone, inst: el._inst, el } : null; },

  onOver(e) {
    const el = e.target.closest?.('.card');
    if (el === this.hover) return;
    this.hover = el && (el.closest('.board') || el.closest('#hand') || el.closest('.zv-grid') || el.closest('.modal')) ? el : null;
    if (!this.hover || !this.hover._inst) { if (Game.active && !e.target.closest?.('[data-preview-bound]')) Preview.hide(); return; }
    const inst = this.hover._inst, mine = this.hover._pid === Game.me;
    const showsBack = this.hover.classList.contains('face-down');
    if (!inst.c || (showsBack && !(mine && inst.faceDown && this.hover.dataset.zone !== 'library'))) { Preview.hide(); return; }
    Preview.show(inst.c, e.clientX, e.clientY, { back: inst.flipped, note: inst.faceDown ? '(face down — only you can see this)' : '' });
    const mv = ev => Preview.move(ev.clientX, ev.clientY);
    const el2 = this.hover; el2.addEventListener('mousemove', mv); el2.addEventListener('mouseleave', () => { el2.removeEventListener('mousemove', mv); if (this.hover === el2) { this.hover = null; Preview.hide(); } }, { once: true });
  },

  /* ---------------- pointer: drag & drop / selection ---------------- */
  onPointerDown(e) {
    if (!this.active() || e.button !== 0) return;
    if (this.arrowing) return; // handled by click
    const cardEl = e.target.closest('.card');
    const counter = e.target.closest('.counter');
    if (counter) return;
    const field = e.target.closest('.battlefield');
    // long-press for touch
    if (e.pointerType === 'touch' && Settings.get('longPressMenu')) {
      const t = setTimeout(() => { this._cancelDrag?.(); this.onContext({ preventDefault() {}, target: e.target, clientX: e.clientX, clientY: e.clientY }); }, 550);
      const clear = () => { clearTimeout(t); document.removeEventListener('pointerup', clear); document.removeEventListener('pointermove', mvClear); };
      const mvClear = ev => { if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) > 8) clear(); };
      document.addEventListener('pointerup', clear); document.addEventListener('pointermove', mvClear);
    }
    if (cardEl && cardEl.dataset.iid && (cardEl.dataset.pid === Game.me || cardEl._pid === Game.me)) return this.startDrag(e, cardEl);
    if (field && field.dataset.pid === Game.me && !cardEl) return this.startBoxSelect(e, field);
  },

  startDrag(e, el) {
    e.preventDefault(); // no text selection / native image drag
    const src = this.cardFromEl(el);
    const sx = e.clientX, sy = e.clientY;
    let dragging = false, ghosts = [], target = null, group = [src.iid];
    const cell = this.cells[Game.me];
    const s = src.zone === 'battlefield' ? cell.s : 1;
    const r = el.getBoundingClientRect();
    // offset of the pointer inside the card, in screen px
    const offX = sx - r.left, offY = sy - r.top;
    const fromViewer = !!el.closest('.zv-grid');
    const move = ev => {
      if (!dragging) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
        dragging = true; Preview.hide(); Menu.closeAll();
        document.body.classList.add('dragging');
        if (src.zone === 'battlefield' && this.sel.has(src.iid) && this.sel.size > 1) group = [...this.sel];
        const bs = cell.s * Settings.get('cardScale');
        const gw = src.zone === 'battlefield' || src.zone === 'hand' ? (src.zone === 'hand' ? el.offsetWidth : CW * bs) : CW * bs, gh = gw * 1.4;
        const showBack = src.zone === 'library' && !fromViewer;
        const g = h('div.drag-ghost', { style: { width: gw + 'px', height: gh + 'px', backgroundImage: el.style.backgroundImage && !showBack ? el.style.backgroundImage : `url("${CARD_BACK}")` } }, group.length > 1 ? h('span.n', null, group.length) : null);
        $('#drag-layer').append(g); ghosts = [g];
        group.forEach(i => $$(`.card[data-iid="${i}"]`).forEach(c => c.classList.add('dragging-src')));
        this._gw = gw; this._gh = gh;
      }
      const g = ghosts[0];
      const fx = src.zone === 'battlefield' ? offX / (r.width / this._gw) : this._gw / 2, fy = src.zone === 'battlefield' ? offY / (r.height / this._gh) : this._gh / 2;
      g.style.left = (ev.clientX - fx) + 'px'; g.style.top = (ev.clientY - fy) + 'px';
      const nt = this.dropTarget(ev.clientX, ev.clientY);
      if (target?.el !== nt?.el) { target?.el.classList.remove('drop-ok'); nt?.el.classList.add('drop-ok'); }
      target = nt;
    };
    const up = ev => {
      cleanup();
      if (!dragging) return;
      this._suppressClick = true; setTimeout(() => (this._suppressClick = false), 60);
      target?.el.classList.remove('drop-ok');
      if (!target) return;
      this.drop(src, group, target, ev, { offX, offY, r });
    };
    const cleanup = () => {
      document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', cleanup);
      ghosts.forEach(g => g.remove()); document.body.classList.remove('dragging');
      $$('.dragging-src').forEach(c => c.classList.remove('dragging-src'));
      $$('.drop-ok').forEach(c => c.classList.remove('drop-ok'));
      this._cancelDrag = null;
    };
    this._cancelDrag = () => { dragging = false; cleanup(); };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up); document.addEventListener('pointercancel', cleanup);
  },

  dropTarget(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    if (el.closest('#hand-dock')) return { zone: 'hand', el: $('#hand') };
    const pile = el.closest('.pile');
    if (pile && pile.dataset.pid === Game.me) return { zone: pile.dataset.zone, el: pile };
    const field = el.closest('.battlefield');
    if (field && field.dataset.pid === Game.me) return { zone: 'battlefield', el: field };
    return null;
  },

  drop(src, group, target, ev, { offX, offY, r }) {
    const cell = this.cells[Game.me];
    if (target.zone === 'battlefield') {
      const fr = target.el.getBoundingClientRect();
      const s = cell.s;
      const scale = Settings.get('cardScale');
      // pointer position in battlefield logical coords, minus grab offset
      let gx, gy;
      if (src.zone === 'battlefield') { gx = offX / (r.width / (CW * scale)); gy = offY / (r.height / (CH * scale)); }
      else { gx = CW * scale / 2; gy = CH * scale / 2; }
      let x = (ev.clientX - fr.left) / s - gx, y = (ev.clientY - fr.top) / s - gy;
      if (Settings.get('snapGrid')) { x = Math.round(x / 20) * 20; y = Math.round(y / 20) * 20; }
      if (src.zone === 'battlefield') {
        const lead = Game.find(src.iid)?.card; if (!lead) return;
        const dx = x - lead.x, dy = y - lead.y;
        Game.pushUndo();
        for (const iid of group) {
          const c = Game.find(iid)?.card; if (!c) continue;
          c.x = clamp(c.x + dx, 0, FW - CW * scale); c.y = clamp(c.y + dy, 0, FH - CH * scale); c.z = ++Game.z;
        }
        Game.sync();
      } else {
        const opts = { x, y };
        if (ev.shiftKey) opts.faceDown = true;
        if (ev.altKey) opts.tapped = true;
        Game.move(src.iid, 'battlefield', opts);
      }
      return;
    }
    if (target.zone === 'hand') {
      const cards = $$('.card', $('#hand')).filter(c => c.dataset.iid !== src.iid);
      let index = cards.findIndex(c => { const rr = c.getBoundingClientRect(); return ev.clientX < rr.left + rr.width / 2; });
      if (index < 0) index = cards.length;
      if (src.zone === 'hand') { Game.pushUndo(); const i = Game.my.hand.findIndex(c => c.iid === src.iid); const [c] = Game.my.hand.splice(i, 1); Game.my.hand.splice(index, 0, c); Game.sync(); }
      else group.length > 1 ? Game.moveMany(group, 'hand') : Game.move(src.iid, 'hand', { index });
      return;
    }
    const opts = {};
    if (target.zone === 'library') opts.pos = ev.shiftKey ? 'bottom' : 'top';
    if (target.zone === 'exile' && ev.shiftKey) opts.faceDown = true;
    if (target.zone === 'library' && src.zone === 'library') { Game.move(src.iid, 'library', opts); return; }
    group.length > 1 ? Game.moveMany(group, target.zone, opts) : Game.move(src.iid, target.zone, opts);
  },

  startBoxSelect(e, field) {
    const cell = this.cells[Game.me], fr = field.getBoundingClientRect(), s = cell.s;
    const x0 = (e.clientX - fr.left) / s, y0 = (e.clientY - fr.top) / s;
    let box = null;
    const additive = e.ctrlKey || e.metaKey || e.shiftKey;
    const move = ev => {
      const x1 = (ev.clientX - fr.left) / s, y1 = (ev.clientY - fr.top) / s;
      if (!box && Math.hypot(x1 - x0, y1 - y0) < 6) return;
      if (!box) { box = h('div.select-box'); field.append(box); if (!additive) this.sel.clear(); }
      const L = Math.min(x0, x1), T = Math.min(y0, y1), W = Math.abs(x1 - x0), H = Math.abs(y1 - y0);
      Object.assign(box.style, { left: L + 'px', top: T + 'px', width: W + 'px', height: H + 'px' });
      const sc = Settings.get('cardScale');
      for (const c of Game.my.battlefield) {
        const hit = c.x < L + W && c.x + CW * sc > L && c.y < T + H && c.y + CH * sc > T;
        if (hit) this.sel.add(c.iid); else if (!additive) this.sel.delete(c.iid);
      }
      $$('.card', field).forEach(el => el.classList.toggle('selected', this.sel.has(el.dataset.iid)));
    };
    const up = () => {
      document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up);
      if (box) { box.remove(); this._suppressClick = true; setTimeout(() => (this._suppressClick = false), 60); announce(`${this.sel.size} cards selected`); }
    };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
  },

  onClick(e) {
    if (!this.active()) return;
    if (this.arrowing) { e.preventDefault(); e.stopPropagation(); this.finishArrow(e.clientX, e.clientY); return; }
    if (this._suppressClick) { this._suppressClick = false; return; }
    const cardEl = e.target.closest('.card');
    const counter = e.target.closest('.counter');
    if (counter && cardEl?.dataset.pid === Game.me) { e.stopPropagation(); Game.addCounter([cardEl.dataset.iid], counter.dataset.counter, 1); return; }
    const pile = e.target.closest('.pile');
    if (pile && !e.target.closest('.modal')) {
      const z = pile.dataset.zone, pid = pile.dataset.pid;
      if (z === 'library' && pid === Game.me) { if (Settings.get('clickLibDraw')) Game.draw(1); }
      else if (z !== 'library') this.viewZone(pid, z);
      return;
    }
    const stat = e.target.closest('.stat[data-act]');
    if (stat) {
      const pid = stat.closest('.b-head').dataset.pid, act = stat.dataset.act;
      if (act === 'hand' && Game.state(pid)?.hand) this.viewZone(pid, 'hand');
      else if (pid === Game.me && ['poison', 'energy', 'exp', 'rad'].includes(act)) Game.setStat(act, 1);
      return;
    }
    if (cardEl && cardEl.dataset.zone === 'battlefield' && cardEl.dataset.pid === Game.me) {
      if (e.ctrlKey || e.metaKey || e.shiftKey) { const id = cardEl.dataset.iid; this.sel.has(id) ? this.sel.delete(id) : this.sel.add(id); cardEl.classList.toggle('selected', this.sel.has(id)); }
      else if (!this.sel.has(cardEl.dataset.iid)) this.clearSel();
      return;
    }
    if (e.target.closest('.battlefield') && !cardEl) this.clearSel();
  },
  clearSel() { this.sel.clear(); $$('.card.selected').forEach(c => c.classList.remove('selected')); },

  onDbl(e) {
    if (!this.active()) return;
    const el = e.target.closest('.card'); if (!el || el.dataset.pid !== Game.me) return;
    if (el.closest('.modal')) return;
    if (el.dataset.zone === 'battlefield' && Settings.get('dblClickTap')) Game.toggleTap(this.targets(el.dataset.iid));
    else if (el.dataset.zone === 'hand') Game.move(el.dataset.iid, 'battlefield');
    else if (el.dataset.zone === 'command') Game.move(el.dataset.iid, 'battlefield');
  },

  targets(iid) { return this.sel.has(iid) && this.sel.size > 1 ? [...this.sel] : [iid]; },

  /* ---------------- context menus ---------------- */
  onContext(e) {
    if (!this.active()) return;
    const inGame = e.target.closest?.('#view-game') || e.target.closest?.('.modal');
    if (!inGame) return;
    if (this.arrowing) { e.preventDefault(); this.cancelArrow(); return; }
    const counter = e.target.closest('.counter'), cardEl = e.target.closest('.card');
    if (counter && cardEl?.dataset.pid === Game.me) { e.preventDefault(); Game.addCounter([cardEl.dataset.iid], counter.dataset.counter, -1); return; }
    const stat = e.target.closest('.stat[data-act]');
    if (stat && stat.closest('.b-head').dataset.pid === Game.me && ['poison', 'energy', 'exp', 'rad'].includes(stat.dataset.act)) { e.preventDefault(); Game.setStat(stat.dataset.act, -1); return; }
    if (e.target.closest('input,textarea,.log')) return;
    const x = e.clientX, y = e.clientY;
    const pile = e.target.closest('.pile');
    if (pile && !e.target.closest('.zv-grid')) { e.preventDefault?.(); return this.pileMenu(x, y, pile.dataset.pid, pile.dataset.zone); }
    if (cardEl && cardEl._inst) { e.preventDefault?.(); return this.cardMenu(x, y, cardEl); }
    const head = e.target.closest('.b-head');
    if (head) { e.preventDefault?.(); return this.playerMenu(e, head.dataset.pid); }
    const field = e.target.closest('.battlefield');
    if (field) { e.preventDefault?.(); return this.fieldMenu(x, y, field.dataset.pid); }
    if (e.target.closest('#hand-dock')) { e.preventDefault?.(); return Menu.show(x, y, this.handMenu(), 'Hand'); }
    if (e.target.closest('.g-table')) e.preventDefault?.();
  },

  cardMenu(x, y, el) {
    const { iid, zone, inst } = this.cardFromEl(el);
    const pid = el._pid || el.dataset.pid, mine = pid === Game.me;
    const c = inst.c;
    const title = c && !(inst.faceDown && !mine) ? (inst.faceDown ? c.name + ' (face down)' : c.name) : 'Face-down card';
    const arrowItem = { label: 'Point an arrow from here', icon: '➹', kb: 'W', action: () => this.beginArrow(this.anchorOfEl(el), true) };
    const scry = c?.uri ? { label: 'Open on Scryfall', icon: '↗', action: () => window.open(c.uri, '_blank', 'noopener') } : null;
    const zoom = c && !(inst.faceDown && !mine) ? { label: 'Enlarge', icon: '🔍', kb: 'Z', action: () => this.enlarge(c, inst.flipped) } : null;
    if (!mine) return Menu.show(x, y, [zoom, arrowItem, scry, '-', { label: `Owner: ${Game.name(pid)}`, disabled: true }], title);
    if (!iid) return;
    const T = this.targets(iid);
    const multi = T.length > 1;
    const mv = (to, opts) => () => multi ? Game.moveMany(T, to, opts) : Game.move(iid, to, opts);
    const moveSub = [
      zone !== 'hand' && { label: 'Hand', kb: 'H', action: mv('hand') },
      zone !== 'battlefield' && { label: 'Battlefield', action: mv('battlefield') },
      zone !== 'battlefield' && { label: 'Battlefield (face down)', action: mv('battlefield', { faceDown: true }) },
      zone !== 'battlefield' && { label: 'Battlefield (tapped)', action: mv('battlefield', { tapped: true }) },
      zone !== 'graveyard' && { label: 'Graveyard', kb: 'G', action: mv('graveyard') },
      zone !== 'exile' && { label: 'Exile', kb: 'X', action: mv('exile') },
      { label: 'Exile face down', action: mv('exile', { faceDown: true }) },
      '-',
      { label: 'Top of library', action: mv('library', { pos: 'top' }) },
      { label: 'Bottom of library', kb: 'B', action: mv('library', { pos: 'bottom' }) },
      { label: 'Into library at position…', action: async () => { const n = await Modal.number('Library position', '1 = top of library', 2); if (n != null) Game.move(iid, 'library', { pos: Math.max(0, n - 1) }); } },
      { label: 'Shuffle into library', action: () => { mv('library', { pos: 'top' })(); Game.shuffleLibrary(); } },
      inst.cmd && zone !== 'command' && { label: 'Command zone', action: mv('command') },
      zone !== 'sideboard' && { label: 'Sideboard', action: mv('sideboard') },
    ];
    if (zone === 'battlefield') {
      const ctr = (k, d) => () => Game.addCounter(T, k, d);
      return Menu.show(x, y, [
        { label: inst.tapped ? 'Untap' : 'Tap', icon: '↷', kb: 'T', action: () => Game.toggleTap(T) },
        c?.back ? { label: 'Transform / flip', icon: '⇄', kb: 'F', action: () => T.forEach(i => Game.flip(i)) } : { label: inst.flip180 ? 'Rotate back' : 'Rotate 180° (flip card)', icon: '⇅', kb: 'F', action: () => T.forEach(i => Game.flip(i)) },
        { label: inst.faceDown ? 'Turn face up' : 'Turn face down', icon: '◩', kb: '⇧F', action: () => T.forEach(i => Game.faceDown(i)) },
        { label: 'Counters', icon: '◉', sub: [
          { label: '+1/+1 counter', kb: 'C', action: ctr('+1/+1', 1) }, { label: 'Remove +1/+1', kb: '⇧C', action: ctr('+1/+1', -1) },
          { label: '−1/−1 counter', action: ctr('-1/-1', 1) }, { label: 'Remove −1/−1', action: ctr('-1/-1', -1) }, '-',
          { label: 'Loyalty +1', action: ctr('loyalty', 1) }, { label: 'Loyalty −1', action: ctr('loyalty', -1) },
          { label: 'Set loyalty…', action: async () => { const n = await Modal.number('Loyalty', c.name, inst.counters.loyalty || +c.loy || 0); if (n != null) Game.addCounter(T, 'loyalty', n - (inst.counters.loyalty || 0)); } }, '-',
          ...['charge', 'shield', 'stun', 'lore', 'oil', 'time', 'defense', 'flying', 'deathtouch', 'lifelink'].map(k => ({ label: `${k[0].toUpperCase() + k.slice(1)} counter`, action: ctr(k, 1) })),
          { label: 'Custom counter…', action: async () => { const k = await Modal.prompt('Custom counter', 'Counter name', 'quest'); if (k) Game.addCounter(T, k.trim().slice(0, 20), 1); } },
          '-', { label: 'Remove all counters', action: () => T.forEach(i => Game.updateCard(i, { counters: {} })) },
        ] },
        { label: 'Set power/toughness…', icon: '⚔', action: async () => { const v = await Modal.prompt('Power / toughness', 'e.g. 5/5 (blank to clear)', inst.pt || c?.pt || ''); if (v != null) T.forEach(i => Game.updateCard(i, { pt: v.trim().slice(0, 9) }, v.trim() ? `${Game.myName()} set ${c?.name}'s P/T to ${v.trim()}.` : '')); } },
        { label: 'Add note…', icon: '✎', action: async () => { const v = await Modal.prompt('Note', 'Shown on the card for everyone', inst.note || ''); if (v != null) Game.updateCard(iid, { note: v.slice(0, 80) }); } },
        { label: inst.dnu ? 'Untaps normally' : "Doesn't untap", icon: '⊘', action: () => T.forEach(i => Game.updateCard(i, { dnu: !Game.find(i)?.card.dnu })) },
        { label: 'Create token copy', icon: '⧉', kb: 'K', action: () => T.forEach(i => Game.clone(i)) },
        '-',
        { label: multi ? `Move ${T.length} cards to` : 'Move to', icon: '→', sub: moveSub.filter(Boolean) },
        { label: 'Bring to front', icon: '▲', action: () => Game.updateCard(iid, { z: ++Game.z }) },
        { label: 'Send to back', icon: '▼', action: () => Game.updateCard(iid, { z: 1 }) },
        inst.faceDown ? { label: 'Reveal to everyone', icon: '👁', action: () => Game.revealCards([inst]) } : null,
        '-', arrowItem, zoom, scry,
      ], multi ? `${T.length} cards selected` : title);
    }
    if (zone === 'hand') {
      return Menu.show(x, y, [
        { label: 'Play', icon: '▶', action: () => Game.move(iid, 'battlefield') },
        { label: 'Play tapped', icon: '↷', action: () => Game.move(iid, 'battlefield', { tapped: true }) },
        { label: 'Play face down (morph / manifest)', icon: '◩', action: () => Game.move(iid, 'battlefield', { faceDown: true }) },
        '-',
        { label: 'Reveal to everyone', icon: '👁', action: () => Game.revealCards([inst]) },
        { label: inst.revealed ? 'Stop revealing' : 'Keep revealed', icon: '◉', action: () => { Game.updateCard(iid, { revealed: !inst.revealed }); } },
        { label: 'Discard', icon: '🗑', kb: 'G', action: () => Game.move(iid, 'graveyard') },
        { label: 'Move to', icon: '→', sub: moveSub.filter(Boolean) },
        !Game.my.kept ? { label: 'Put on bottom (mulligan)', icon: '⤓', action: () => Game.move(iid, 'library', { pos: 'bottom' }) } : null,
        '-', zoom, scry,
      ], title);
    }
    // piles / viewers
    return Menu.show(x, y, [
      zone === 'command' && inst.cmd ? { label: `Cast commander (tax ${(inst.casts || 0) * 2})`, icon: '♛', action: () => Game.move(iid, 'battlefield') } : null,
      zone === 'command' && inst.cmd ? { label: 'Reset commander tax', icon: '↺', action: () => Game.updateCard(iid, { casts: 0 }, `${Game.myName()} reset ${c.name}'s commander tax.`) } : null,
      ...moveSub.filter(Boolean),
      '-', zone !== 'library' ? { label: 'Reveal to everyone', icon: '👁', action: () => Game.revealCards([inst]) } : null, arrowItem, zoom, scry,
    ], title);
  },

  pileMenu(x, y, pid, zone) {
    const mine = pid === Game.me;
    if (!mine) {
      const st = Game.state(pid);
      return Menu.show(x, y, [
        zone !== 'library' ? { label: `View ${ZONE_LABEL[zone]}`, icon: '👁', action: () => this.viewZone(pid, zone) } : { label: `${st?.libCount ?? '?'} cards`, disabled: true },
        { label: 'Point an arrow from here', icon: '➹', action: () => this.beginArrow({ t: 'pile', pid, zone }, true) },
      ], `${Game.name(pid)}'s ${ZONE_LABEL[zone]}`);
    }
    const ask = (t, l, d, fn) => async () => { const n = await Modal.number(t, l, d); if (n > 0) fn(n); };
    const m = Game.my;
    const items = {
      library: [
        { label: 'Draw', icon: '✋', kb: 'D', action: () => Game.draw(1) },
        { label: 'Draw X…', icon: '✋', kb: '⇧D', action: ask('Draw', 'How many cards?', 2, n => Game.draw(n)) },
        { label: 'Shuffle', icon: '🔀', kb: 'S', action: () => Game.shuffleLibrary() },
        '-',
        { label: 'View top X (scry / surveil)…', icon: '👁', action: ask('Look at the top', 'How many cards?', 3, n => this.viewZone(Game.me, 'library', { top: n })) },
        { label: 'Search library', icon: '🔍', action: () => this.viewZone(Game.me, 'library') },
        { label: 'Mill X…', icon: '⤓', kb: 'M', action: ask('Mill', 'How many cards?', 1, n => Game.mill(n)) },
        { label: 'Exile top X…', icon: '✕', action: ask('Exile from top', 'How many cards?', 1, n => Game.exileTop(n)) },
        { label: 'Exile top card face down', icon: '◩', action: () => Game.exileTop(1, true) },
        { label: 'Top card → battlefield', icon: '▶', action: () => m.library[0] && Game.move(m.library[0].iid, 'battlefield') },
        { label: 'Manifest (top card face down)', icon: '◩', action: () => m.library[0] && Game.move(m.library[0].iid, 'battlefield', { faceDown: true }) },
        { label: 'Top card → bottom', icon: '⤓', action: () => m.library[0] && Game.move(m.library[0].iid, 'library', { pos: 'bottom' }) },
        '-',
        { label: 'Reveal top card', icon: '👁', action: () => m.library[0] && Game.revealCards([m.library[0]], 'top of library') },
        { label: m.topRevealed ? 'Stop playing with top revealed' : 'Play with top card revealed', icon: '◉', action: () => Game.toggleTopReveal() },
        { label: 'Reveal until… (cascade / discover)', icon: '⇣', action: () => this.revealUntil() },
      ],
      graveyard: [
        { label: 'View graveyard', icon: '👁', action: () => this.viewZone(Game.me, 'graveyard') },
        { label: 'Shuffle graveyard into library', icon: '🔀', action: async () => { if (Settings.get('confirmDanger') && !(await Modal.confirm('Shuffle graveyard', 'Shuffle your whole graveyard into your library?', 'Shuffle'))) return; Game.moveMany(m.graveyard.map(c => c.iid), 'library'); Game.shuffleLibrary(); } },
        { label: 'Exile graveyard', icon: '✕', action: () => Game.moveMany(m.graveyard.map(c => c.iid), 'exile') },
        { label: 'Random card → hand', icon: '🎲', action: () => m.graveyard.length && Game.move(m.graveyard[randInt(m.graveyard.length)].iid, 'hand') },
      ],
      exile: [
        { label: 'View exile', icon: '👁', action: () => this.viewZone(Game.me, 'exile') },
        { label: 'Return all to graveyard', icon: '↩', action: () => Game.moveMany(m.exile.map(c => c.iid), 'graveyard') },
      ],
      command: [
        { label: 'View command zone', icon: '👁', action: () => this.viewZone(Game.me, 'command') },
        ...m.command.filter(c => c.cmd).map(c => ({ label: `Cast ${c.c.name} (tax ${(c.casts || 0) * 2})`, icon: '♛', action: () => Game.move(c.iid, 'battlefield') })),
      ],
    }[zone];
    Menu.show(x, y, items, `Your ${ZONE_LABEL[zone]}`);
  },

  fieldMenu(x, y, pid) {
    const cell = this.cells[pid];
    const pt = this.screenToBoard(pid, x, y);
    if (pid !== Game.me) return Menu.show(x, y, [
      { label: 'Point an arrow from here', icon: '➹', action: () => this.beginArrow({ t: 'pt', pid, x: pt.x, y: pt.y }, true) },
      { label: `View ${Game.name(pid)}'s graveyard`, icon: '👁', action: () => this.viewZone(pid, 'graveyard') },
      { label: `View ${Game.name(pid)}'s exile`, icon: '👁', action: () => this.viewZone(pid, 'exile') },
    ], Game.name(pid));
    const fieldPt = { x: pt.x - PILES - CW / 2, y: pt.y - HEAD - CH / 2 };
    Menu.show(x, y, [
      { label: 'Untap all', icon: '↺', kb: 'U', action: () => Game.untapAll() },
      { label: 'Draw a card', icon: '✋', kb: 'D', action: () => Game.draw(1) },
      { label: 'Create token…', icon: '✚', action: () => this.tokenModal(fieldPt) },
      { label: 'Select all', icon: '▣', action: () => { Game.my.battlefield.forEach(c => this.sel.add(c.iid)); this.update(Game.me); } },
      { label: 'Tidy up battlefield', icon: '▦', action: () => this.tidy() },
      '-',
      { label: 'Roll', icon: '🎲', sub: this.diceItems() },
      { label: 'Flip a coin', icon: '🪙', action: () => Game.flipCoin() },
      { label: 'Point an arrow from here', icon: '➹', action: () => this.beginArrow({ t: 'pt', pid, x: pt.x, y: pt.y }, true) },
      { label: 'Clear my arrows', icon: '✕', kb: '⇧W', action: () => Game.clearArrows() },
      '-',
      { label: 'Undo', icon: '↶', kb: 'Ctrl+Z', action: () => Game.undo(), disabled: !Game.undoStack.length },
    ], 'Battlefield');
  },

  handMenu() {
    const m = Game.my;
    return [
      { label: 'Draw', icon: '✋', kb: 'D', action: () => Game.draw(1) },
      { label: m.handRevealed ? 'Hide hand' : 'Reveal hand to everyone', icon: '👁', action: () => Game.revealHand() },
      { label: 'Reveal hand once', icon: '👁', action: () => Game.revealCards(m.hand, 'hand') },
      { label: 'Discard at random', icon: '🎲', action: () => m.hand.length && Game.move(m.hand[randInt(m.hand.length)].iid, 'graveyard') },
      { label: 'Discard hand', icon: '🗑', action: () => Game.moveMany(m.hand.map(c => c.iid), 'graveyard') },
      { label: 'Shuffle hand into library', icon: '🔀', action: () => { Game.moveMany(m.hand.map(c => c.iid), 'library'); Game.shuffleLibrary(); } },
      { label: 'Sort hand', icon: '⇅', action: () => $('#hand-sort').click() },
      !m.kept ? '-' : null,
      !m.kept ? { label: 'Keep', icon: '✓', action: () => Game.keep() } : null,
      !m.kept ? { label: 'Mulligan', icon: '↺', action: () => Game.mulligan() } : null,
    ];
  },

  playerMenu(e, pid) {
    const mine = pid === Game.me, st = Game.state(pid) || {};
    const life = d => () => Game.setLife(d);
    const items = mine ? [
      { label: 'Life', icon: '♥', sub: [
        { label: '+1', action: life(1) }, { label: '−1', action: life(-1) }, { label: '+5', action: life(5) }, { label: '−5', action: life(-5) },
        { label: 'Set life…', action: async () => { const n = await Modal.number('Set life', 'Life total', Game.my.life); if (n != null) Game.setLife(n - Game.my.life); } },
        { label: 'Life history', action: () => Modal.open({ title: 'Life history', size: 'narrow', body: h('ol', null, Game.my.lifeHistory.map(l => h('li', null, `Turn ${l.t}: ${l.from} → ${l.to}`))) }) },
      ] },
      { label: 'Counters', icon: '◉', sub: [['poison', 'Poison'], ['energy', 'Energy'], ['exp', 'Experience'], ['rad', 'Rad']].flatMap(([k, l]) => [{ label: `${l} +1`, action: () => Game.setStat(k, 1) }, { label: `${l} −1`, action: () => Game.setStat(k, -1) }]) },
      { label: Game.my.handRevealed ? 'Hide hand' : 'Reveal hand', icon: '👁', action: () => Game.revealHand() },
      { label: 'View sideboard', icon: '📋', action: () => this.viewZone(Game.me, 'sideboard') },
      '-',
      { label: 'Concede', icon: '☠', action: async () => { if (!Settings.get('confirmDanger') || await Modal.confirm('Concede', 'Concede this game?', 'Concede', true)) Game.concede(); } },
    ] : [
      st.hand ? { label: 'View revealed hand', icon: '👁', action: () => this.viewZone(pid, 'hand') } : { label: `${st.handCount ?? '?'} cards in hand`, disabled: true },
      { label: 'View graveyard', icon: '👁', action: () => this.viewZone(pid, 'graveyard') },
      { label: 'View exile', icon: '👁', action: () => this.viewZone(pid, 'exile') },
      { label: 'Point an arrow at this player', icon: '➹', action: () => this.beginArrow({ t: 'head', pid }, true) },
    ];
    items.push('-',
      { label: `Make ${mine ? 'me' : Game.name(pid)} the monarch`, icon: '👑', action: () => { Game.setGlobal({ monarch: pid }); Game.log(`${Game.name(pid)} became the monarch.`); } },
      { label: `Give ${mine ? 'me' : Game.name(pid)} the initiative`, icon: '🗝', action: () => { Game.setGlobal({ initiative: pid }); Game.log(`${Game.name(pid)} took the initiative.`); } });
    Menu.show(e.clientX, e.clientY, items, Game.name(pid));
  },

  pickPlayerMenu(e, label, fn) {
    const r = e.currentTarget.getBoundingClientRect();
    Menu.show(r.left, r.bottom + 4, [...Game.seating.map(pid => ({ label: Game.name(pid), action: () => fn(pid) })), '-', { label: 'Nobody', action: () => fn(null) }], label);
  },
  diceItems() { return [...[4, 6, 8, 10, 12, 20, 100].map(n => ({ label: `d${n}`, action: () => Game.roll(n) })), { label: 'Custom…', action: async () => { const n = await Modal.number('Roll', 'Number of sides', 20); if (n > 1) Game.roll(n); } }, { label: 'Planar die', action: () => { const r = randInt(6); Game.log(`${Game.myName()} rolled the planar die: ${r === 0 ? 'Planeswalk ⟁' : r === 1 ? 'Chaos ✺' : 'blank'}.`); } }]; },
  diceMenu(e) { const r = e.currentTarget.getBoundingClientRect(); Menu.show(r.left, r.bottom + 4, this.diceItems(), 'Roll'); },

  toolsMenu() {
    const m = Game.my;
    return [
      { label: 'Draw', icon: '✋', kb: 'D', action: () => Game.draw(1) },
      { label: 'Draw X…', icon: '✋', kb: '⇧D', action: async () => { const n = await Modal.number('Draw', 'How many?', 2); if (n > 0) Game.draw(n); } },
      { label: 'Shuffle library', icon: '🔀', kb: 'S', action: () => Game.shuffleLibrary() },
      { label: 'Untap all', icon: '↺', kb: 'U', action: () => Game.untapAll() },
      { label: 'Create token…', icon: '✚', action: () => this.tokenModal() },
      { label: 'Search library', icon: '🔍', action: () => this.viewZone(Game.me, 'library') },
      { label: 'View sideboard', icon: '📋', action: () => this.viewZone(Game.me, 'sideboard') },
      '-',
      { label: 'Roll', icon: '🎲', sub: this.diceItems() },
      { label: 'Flip a coin', icon: '🪙', action: () => Game.flipCoin() },
      { label: m.handRevealed ? 'Hide hand' : 'Reveal hand', icon: '👁', action: () => Game.revealHand() },
      '-',
      { label: 'Undo', icon: '↶', kb: 'Ctrl+Z', disabled: !Game.undoStack.length, action: () => Game.undo() },
      { label: 'Clear my arrows', icon: '✕', kb: '⇧W', action: () => Game.clearArrows() },
      { label: 'Clear everyone\'s arrows', icon: '✕', action: () => { Game.arrows = []; Net.broadcast('arrows-clear', { owner: '*' }); } },
      '-',
      Game.M.match || Game.deckSrc.side.length ? { label: 'Sideboard & next game…', icon: '📋', action: () => Game.sideboardModal() } : null,
      { label: 'Restart my game', icon: '⟲', action: async () => { if (!Settings.get('confirmDanger') || await Modal.confirm('Restart', 'Reset your board, reshuffle and draw a new hand?', 'Restart', true)) Game.newGame(); } },
      { label: 'Concede', icon: '☠', action: async () => { if (!Settings.get('confirmDanger') || await Modal.confirm('Concede', 'Concede this game?', 'Concede', true)) Game.concede(); } },
      { label: 'Leave table', icon: '⏏', action: async () => { if (await Modal.confirm('Leave table', 'Leave this game and return to the lobby?', 'Leave', true)) Game.leave(); } },
    ];
  },

  viewMenu() {
    const v = Settings.get('boardView'), chk = b => b ? '✓' : '';
    return [
      { label: 'Focus — you large, opponents above', icon: chk(v === 'focus'), action: () => Settings.set('boardView', 'focus') },
      { label: 'Grid — equal boards', icon: chk(v === 'grid'), action: () => Settings.set('boardView', 'grid') },
      { label: 'Spotlight — one opponent at a time', icon: chk(v === 'spotlight'), action: () => Settings.set('boardView', 'spotlight') },
      '-',
      { label: 'Face-to-face opponents', icon: chk(Settings.get('mirrorOpps')), action: () => Settings.set('mirrorOpps', !Settings.get('mirrorOpps')) },
      { label: 'Show card names', icon: chk(Settings.get('showNames')), action: () => Settings.set('showNames', !Settings.get('showNames')) },
      { label: 'Spread hand', icon: chk(Settings.get('handSpread')), action: () => Settings.set('handSpread', !Settings.get('handSpread')) },
      { label: 'Bigger cards', icon: '+', action: () => Settings.set('cardScale', Math.min(1.4, +(Settings.get('cardScale') + .1).toFixed(2))) },
      { label: 'Smaller cards', icon: '−', action: () => Settings.set('cardScale', Math.max(.7, +(Settings.get('cardScale') - .1).toFixed(2))) },
      { label: 'Toggle side panel', icon: '☰', action: () => $('#g-side-toggle').click() },
      '-',
      { label: 'All display settings…', icon: '⚙', action: () => Settings.openModal('Display') },
      { label: 'Accessibility…', icon: '♿', action: () => Settings.openModal('Accessibility') },
    ];
  },

  tidy() {
    Game.pushUndo();
    const list = [...Game.my.battlefield].sort((a, b) => (primaryType(a.c?.type) === 'Land') - (primaryType(b.c?.type) === 'Land') || (a.c?.name || '').localeCompare(b.c?.name || ''));
    const placed = [];
    const saved = Game.my.battlefield; Game.my.battlefield = placed;
    for (const c of list) { Object.assign(c, Game.freeSpot(c)); placed.push(c); }
    Game.my.battlefield = saved; Game.sync();
  },

  /* ---------------- keyboard ---------------- */
  onKey(e) {
    if (e.key === 'Escape') {
      if (this.arrowing) { this.cancelArrow(); return; }
      if (!e.voidHandled && this.active()) this.clearSel();
      return;
    }
    if (isTyping(e)) return;
    if (e.key === '?' ) { Modal.open({ title: 'Keyboard shortcuts', id: 'shortcuts', body: Settings.shortcutsTable() }); return; }
    if (e.key === 'Alt' || e.key === 'z' || e.key === 'Z') { if (!e.ctrlKey && !e.metaKey) { Preview.altHeld = true; if (this.hover?._inst?.c) Preview.show(this.hover._inst.c, this.mouse.x, this.mouse.y, { back: this.hover._inst.flipped }); if (e.key === 'Alt') e.preventDefault(); } }
    if (!this.active() || Menu.isOpen()) return;
    if (Modal.stack.some(m => !m.back.classList.contains('nonblocking'))) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); Game.undo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const hov = this.hover && this.hover._pid === Game.me && this.hover.dataset.iid ? this.hover : null;
    const T = hov ? this.targets(hov.dataset.iid) : [...this.sel];
    if (k === 'w') {
      e.preventDefault();
      if (e.shiftKey) { Game.clearArrows(); return; }
      if (e.repeat) return;
      if (this.arrowing) { this.finishArrow(this.mouse.x, this.mouse.y); return; }
      const a = this.anchorAt(this.mouse.x, this.mouse.y);
      if (!a) { toast('Point at a battlefield, card or player to start an arrow'); return; }
      this.beginArrow(a, false);
      return;
    }
    const run = {
      d: () => e.shiftKey ? Modal.number('Draw', 'How many?', 2).then(n => n > 0 && Game.draw(n)) : Game.draw(1),
      u: () => Game.untapAll(),
      s: () => Game.shuffleLibrary(),
      m: () => Game.mill(1),
      n: () => Game.canAct() && Game.nextPhase(),
      e: () => Game.canAct() && Game.passTurn(),
      t: () => T.length && Game.toggleTap(T),
      f: () => hov && (e.shiftKey ? T.forEach(i => Game.faceDown(i)) : T.forEach(i => Game.flip(i))),
      c: () => T.length && Game.addCounter(T, '+1/+1', e.shiftKey ? -1 : 1),
      g: () => T.length && (T.length > 1 ? Game.moveMany(T, 'graveyard') : Game.move(T[0], 'graveyard')),
      x: () => T.length && (T.length > 1 ? Game.moveMany(T, 'exile') : Game.move(T[0], 'exile')),
      h: () => T.length && (T.length > 1 ? Game.moveMany(T, 'hand') : Game.move(T[0], 'hand')),
      b: () => T.length && (T.length > 1 ? Game.moveMany(T, 'library', { pos: 'bottom' }) : Game.move(T[0], 'library', { pos: 'bottom' })),
      k: () => T.forEach(i => Game.clone(i)),
      '+': () => Game.setLife(1), '=': () => Game.setLife(1), '-': () => Game.setLife(-1), '_': () => Game.setLife(-1),
    }[e.key === '+' || e.key === '-' || e.key === '=' || e.key === '_' ? e.key : k];
    if (run) { e.preventDefault(); run(); }
  },
  onKeyUp(e) {
    if (e.key === 'Alt' || e.key.toLowerCase() === 'z') { Preview.altHeld = false; if (Settings.get('preview') === 'alt') Preview.hide(); }
    if (e.key.toLowerCase() === 'w' && this.arrowing && !this.arrowing.tapMode) {
      if (Date.now() - this.arrowing.t0 < 220) this.arrowing.tapMode = true; // quick tap: wait for second W / click
      else this.finishArrow(this.mouse.x, this.mouse.y);
    }
  },
  cardKey(e) {
    const el = e.target.closest?.('.card'); if (!el) return;
    if (e.key === 'Enter' || (e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
      e.preventDefault(); const r = el.getBoundingClientRect(); this.cardMenu(r.left + r.width / 2, r.top + r.height / 2, el);
    } else if (e.key === ' ' && el.dataset.zone === 'battlefield' && el.dataset.pid === Game.me) { e.preventDefault(); Game.toggleTap([el.dataset.iid]); }
  },

  /* ======================= arrows ======================= */
  anchorOfEl(el) {
    if (el.closest('#hand')) return { t: 'card', pid: Game.me, iid: el.dataset.iid };
    if (el.closest('.pile')) { const p = el.closest('.pile'); return { t: 'pile', pid: p.dataset.pid, zone: p.dataset.zone }; }
    return { t: 'card', pid: el.dataset.pid, iid: el.dataset.iid };
  },
  anchorAt(x, y) {
    const el = document.elementFromPoint(x, y); if (!el) return null;
    const card = el.closest('.card');
    if (card && card.dataset.iid && (card.closest('.board') || card.closest('#hand'))) return this.anchorOfEl(card);
    const pile = el.closest('.pile'); if (pile) return { t: 'pile', pid: pile.dataset.pid, zone: pile.dataset.zone };
    const head = el.closest('.b-head'); if (head) return { t: 'head', pid: head.dataset.pid };
    const prow = el.closest('#g-players .pl-row');
    const board = el.closest('.board');
    if (board) { const pid = board.dataset.pid, p = this.screenToBoard(pid, x, y); return { t: 'pt', pid, x: p.x, y: p.y }; }
    if (el.closest('#hand-dock')) return { t: 'head', pid: Game.me };
    return null;
  },
  screenToBoard(pid, x, y) {
    const c = this.cells[pid]; const r = c.cell.getBoundingClientRect();
    let lx = (x - r.left - c.ox) / c.s, ly = (y - r.top - c.oy) / c.s;
    if (c.mirror) { lx = BW - lx; ly = BH - ly; }
    return { x: Math.round(lx), y: Math.round(ly) };
  },
  boardToScreen(pid, x, y) {
    const c = this.cells[pid]; if (!c || c.cell.classList.contains('spot-hidden')) return null;
    const r = c.cell.getBoundingClientRect(); if (!r.width) return null;
    if (c.mirror) { x = BW - x; y = BH - y; }
    return { x: r.left + c.ox + x * c.s, y: r.top + c.oy + y * c.s };
  },
  resolve(a) {
    if (!a) return null;
    const center = el => { const r = el.getBoundingClientRect(); return r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; };
    if (a.t === 'card') {
      const el = document.querySelector(`.board .card[data-iid="${a.iid}"]`) || (a.pid === Game.me ? document.querySelector(`#hand .card[data-iid="${a.iid}"]`) : null);
      if (el && !el.closest('.spot-hidden')) return center(el);
      if (el?.closest('.spot-hidden')) return null;
      return this.resolve({ t: 'head', pid: a.pid });
    }
    if (a.t === 'pile') { const el = this.cells[a.pid]?.piles.querySelector(`.pile[data-zone="${a.zone}"]`); return el && !el.closest('.spot-hidden') ? center(el) : null; }
    if (a.t === 'head') {
      const c = this.cells[a.pid]; if (!c || c.cell.classList.contains('spot-hidden')) return null;
      return this.boardToScreen(a.pid, 330, 26);
    }
    if (a.t === 'pt') return this.boardToScreen(a.pid, a.x, a.y);
    return null;
  },
  beginArrow(from, tapMode) {
    this.arrowing = { from, t0: Date.now(), tapMode };
    document.body.classList.add('arrowing');
    if (tapMode) toast('Click (or press W) where the arrow should point · Esc to cancel', '', 2500);
  },
  finishArrow(x, y) {
    const a = this.arrowing; if (!a) return;
    this.cancelArrow();
    const to = this.anchorAt(x, y);
    if (!to) return;
    const p1 = this.resolve(a.from), p2 = this.resolve(to);
    if (JSON.stringify(a.from) === JSON.stringify(to) || (p1 && p2 && Math.hypot(p1.x - p2.x, p1.y - p2.y) < 12)) return;
    Game.addArrow(a.from, to);
  },
  cancelArrow() { this.arrowing = null; document.body.classList.remove('arrowing'); },

  startLoops() {
    if (this._loop) return;
    let lastClock = 0;
    const tick = t => {
      this._loop = requestAnimationFrame(tick);
      if (!Game.active) { $('#arrow-layer').innerHTML = ''; return; }
      this.drawArrows();
      if (Game.settings.timer && t - lastClock > 500) { lastClock = t; this.renderClock(); }
    };
    this._loop = requestAnimationFrame(tick);
  },
  renderClock() {
    const fmt = ms => { const neg = ms < 0; ms = Math.abs(ms); const m = Math.floor(ms / 60000), s = Math.floor(ms / 1000) % 60; return (neg ? '−' : '') + m + ':' + String(s).padStart(2, '0'); };
    const left = Game.clockLeft(Game.turn.active);
    const c = $('#g-clock'); c.textContent = '⏱ ' + fmt(left); c.classList.toggle('low', left < 60000);
    $$('[data-clock]').forEach(b => b.textContent = '⏱' + fmt(Game.clockLeft(b.dataset.clock)));
  },
  drawArrows() {
    const svg = $('#arrow-layer');
    const list = Game.arrows.map(a => ({ a, p1: this.resolve(a.from), p2: this.resolve(a.to) }));
    if (this.arrowing) list.push({ live: true, a: { owner: Game.me }, p1: this.resolve(this.arrowing.from), p2: { x: this.mouse.x, y: this.mouse.y } });
    if (!list.length) { if (svg.childElementCount) svg.innerHTML = ''; return; }
    const w = Settings.get('arrowWidth');
    let out = '';
    for (const { a, p1, p2, live } of list) {
      if (!p1 || !p2) continue;
      const dx = p2.x - p1.x, dy = p2.y - p1.y, len = Math.hypot(dx, dy); if (len < 4) continue;
      const nx = -dy / len, ny = dx / len, bend = Math.min(80, len * .18);
      const cx = (p1.x + p2.x) / 2 + nx * bend, cy = (p1.y + p2.y) / 2 + ny * bend;
      // arrow head
      const tx = p2.x - cx, ty = p2.y - cy, tl = Math.hypot(tx, ty) || 1, ux = tx / tl, uy = ty / tl;
      const hl = w * 3.2, hw = w * 2.2;
      const bx = p2.x - ux * hl, by = p2.y - uy * hl;
      out += `<path class="shaft${live ? ' live' : ''}" d="M${p1.x},${p1.y} Q${cx},${cy} ${bx},${by}" stroke-width="${w}"/>`;
      out += `<polygon class="tail" points="${p2.x},${p2.y} ${bx - uy * hw},${by + ux * hw} ${bx + uy * hw},${by - ux * hw}"/>`;
      out += `<circle cx="${p1.x}" cy="${p1.y}" r="${w * .9}" fill="${Game.color(a.owner)}" stroke="#000" stroke-width="2"/>`;
      if (Game.seating.length > 1 && !live) out += `<text x="${p1.x + 10}" y="${p1.y - 10}">${esc(Game.name(a.owner))}</text>`;
    }
    svg.innerHTML = out;
  },

  /* ======================= modals ======================= */
  viewZone(pid, zone, { top } = {}) {
    const mine = pid === Game.me;
    const existing = this.viewers.find(v => v.pid === pid && v.zone === zone && v.top === top);
    if (existing) { existing.modal.modal.querySelector('input')?.focus(); return; }
    const filter = h('input', { placeholder: 'Filter by name or type…', style: { flex: 1, minWidth: '160px' } });
    const grid = h('div.zv-grid');
    const tools = h('div.zv-tools', null, filter);
    const title = `${mine ? 'Your' : Game.name(pid) + "'s"} ${zone === 'library' && top ? `top ${top} of library` : ZONE_LABEL[zone]}`;
    const v = { pid, zone, top };
    if (mine && zone === 'library') {
      tools.append(h('span.muted.small', null, 'Drag cards out, or right-click for options. 1 = top.'));
      Game.log(top ? `${Game.myName()} is looking at the top ${top} card${top > 1 ? 's' : ''} of their library.` : `${Game.myName()} is searching their library.`);
    }
    if (mine && zone !== 'library' && zone !== 'hand') tools.append(h('span.muted.small', null, 'Drag cards to any zone. Right-click for options.'));
    if (mine && zone === 'library' && top) tools.append(h('button.btn.small', { onclick: () => { const ids = Game.my.library.slice(0, top).map(c => c.iid); Game.moveMany(ids, 'library', { pos: 'bottom' }); } }, 'All to bottom'), h('button.btn.small', { onclick: () => { const ids = Game.my.library.slice(0, top).map(c => c.iid); Game.moveMany(ids, 'graveyard'); } }, 'All to graveyard'));
    v.render = () => {
      const st = Game.state(pid);
      let list = zone === 'library' ? (mine ? Game.my.library : []) : zone === 'sideboard' ? (mine ? Game.my.sideboard : []) : zone === 'hand' ? (mine ? Game.my.hand : (st?.hand || [])) : (st?.[zone] || []);
      if (zone === 'library' && top) list = list.slice(0, top);
      const f = filter.value.toLowerCase();
      const ordered = zone === 'graveyard' || zone === 'exile' ? [...list].reverse() : list;
      grid.replaceChildren(...ordered.filter(c => !f || (c.c && (c.c.name.toLowerCase().includes(f) || c.c.type?.toLowerCase().includes(f)))).map((inst, i) => {
        const el = this.cardEl(inst, pid, zone, { back: !inst.c || (!mine && inst.faceDown) });
        if (zone === 'library') el.append(h('span.idx', null, list.indexOf(inst) + 1));
        return el;
      }));
      if (!ordered.length) grid.append(h('p.muted', null, 'Empty.'));
      v.modal.modal.querySelector('h2').textContent = `${title} (${list.length})`;
    };
    filter.oninput = () => v.render();
    v.modal = Modal.open({ title, size: 'wide', nonblocking: true, body: h('div', null, tools, grid), onClose: () => {
      this.viewers = this.viewers.filter(x => x !== v);
      if (mine && zone === 'library' && !top && Game.active) toast('Done searching?', '', 8000, { label: 'Shuffle library', fn: () => Game.shuffleLibrary() });
    } });
    this.viewers.push(v); v.render();
  },

  showReveal(title, cards) {
    const grid = h('div.zv-grid', null, cards.map(c => { const el = this.cardEl({ iid: '', c, counters: {} }, 'reveal', 'reveal'); return el; }));
    Modal.open({ title, size: 'wide', nonblocking: true, body: grid });
    Sound.play('chat');
  },

  chooseBottom(n) {
    const chosen = new Set();
    const grid = h('div.zv-grid');
    const btn = h('button.btn.primary', { disabled: true }, `Put ${n} on bottom`);
    const render = () => {
      grid.replaceChildren(...Game.my.hand.map(inst => {
        const el = this.cardEl(inst, 'choose', 'choose');
        if (chosen.has(inst.iid)) el.style.outline = '4px solid var(--accent)';
        el.onclick = () => { chosen.has(inst.iid) ? chosen.delete(inst.iid) : chosen.size < n && chosen.add(inst.iid); render(); };
        return el;
      }));
      btn.disabled = chosen.size !== n; btn.textContent = `Put ${chosen.size}/${n} on bottom`;
    };
    render();
    const m = Modal.open({ title: `Choose ${n} card${n > 1 ? 's' : ''} to put on the bottom`, size: 'wide', body: grid, foot: [btn] });
    btn.onclick = () => { [...chosen].forEach(i => Game.move(i, 'library', { pos: 'bottom', silent: true })); Game.log(`${Game.myName()} put ${n} card${n > 1 ? 's' : ''} on the bottom of their library.`); m.close(); };
  },

  enlarge(c, back) {
    const img = h('img', { src: back && c.backL ? c.backL : c.imgL || c.img, alt: c.name, style: { width: '100%', borderRadius: '4.5%/3.2%' } });
    const body = h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: '1rem' } }, img,
      h('div', null, h('h3', { html: esc(c.name) + ' ' + manaHTML(c.mana) }), h('p.muted', null, c.type), h('p', { style: { whiteSpace: 'pre-wrap' } }, c.text || ''), c.pt ? h('p', null, h('b', null, c.pt)) : null,
        h('p.muted.small', null, `${c.setName || c.set?.toUpperCase() || ''} #${c.cn || ''}`), c.uri ? h('a', { href: c.uri, target: '_blank', rel: 'noopener' }, 'View on Scryfall ↗') : null));
    Modal.open({ title: c.name, body });
  },

  async revealUntil() {
    const q = await Modal.prompt('Reveal until…', 'Stop at the first card whose type includes (e.g. "Land", "Creature"), or mana value less than N (e.g. "<5")', 'Land');
    if (!q) return;
    const lib = Game.my.library; const revealed = [];
    const lt = q.trim().match(/^<\s*(\d+)$/);
    let hit = null;
    for (const c of lib) { revealed.push(c); if (lt ? (c.c.cmc < +lt[1] && primaryType(c.c.type) !== 'Land') : c.c.type.toLowerCase().includes(q.toLowerCase())) { hit = c; break; } }
    Game.revealCards(revealed, `revealing until ${q}`);
    this.showReveal(`You revealed ${revealed.length} card${revealed.length === 1 ? '' : 's'}${hit ? ' — hit: ' + hit.c.name : ' — no hit'}`, revealed.map(c => c.c));
    if (hit) toast(`Hit ${hit.c.name}. Use Search library to move cards, then shuffle or bottom the rest.`, '', 7000);
  },

  tokenModal(pos) {
    const q = h('input', { placeholder: 'Search tokens… e.g. treasure, 1/1 soldier, zombie', autofocus: true, style: { flex: 1 } });
    const qty = h('input', { type: 'number', value: 1, min: 1, max: 99, class: 'inline-num', 'aria-label': 'How many' });
    const grid = h('div.zv-grid');
    const status = h('p.muted.small');
    const go = async () => {
      const t = q.value.trim();
      status.textContent = 'Searching Scryfall…';
      try {
        const r = await Scry.search(`(t:token or t:emblem) ${t ? `(name:"${t.replace(/"/g, '')}" or o:"${t.replace(/"/g, '')}" or t:"${t.replace(/"/g, '')}")` : ''}`.trim(), { unique: 'art', includeExtras: true, order: 'name' });
        const cards = (r.data || []).slice(0, 120).map(c => Scry.gameCard(Scry.slim(c)));
        status.textContent = r.notFound ? 'No tokens found.' : `${r.total_cards} token${r.total_cards === 1 ? '' : 's'} — click to create`;
        grid.replaceChildren(...cards.map(c => { const el = this.cardEl({ iid: '', c, counters: {} }, 'pick', 'pick'); el.title = `${c.name} — ${c.type}`; el.onclick = () => { Game.createToken(c, Math.max(1, +qty.value || 1), pos); m.close(); }; return el; }));
      } catch (e) { status.textContent = e.message; }
    };
    q.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    const quick = h('div.toggles', null, ['Treasure', 'Clue', 'Food', 'Blood', 'Soldier', 'Zombie', 'Goblin', 'Spirit', 'Saproling', 'Beast', 'Elf Warrior', 'Thopter', 'Angel', 'Dragon'].map(n => h('button.btn.small', { onclick: () => { q.value = n; go(); } }, n)));
    const cName = h('input', { placeholder: 'Name', value: 'Token' }), cPT = h('input', { placeholder: 'P/T e.g. 2/2', style: { width: '6rem' } }), cType = h('input', { placeholder: 'Type e.g. Creature — Elemental' });
    const custom = h('details.adv', null, h('summary', null, 'Custom token'), h('div.row.gap.wrap', null, cName, cPT, cType,
      h('button.btn', { onclick: () => { Game.createToken({ id: 'custom', name: cName.value || 'Token', img: '', type: cType.value || 'Token Creature', pt: cPT.value, text: '', mana: '', cmc: 0 }, Math.max(1, +qty.value || 1), pos); m.close(); } }, 'Create')));
    const m = Modal.open({ title: 'Create token', size: 'wide', body: h('div', null, h('div.row.gap', { style: { marginBottom: '.6rem' } }, q, h('label.row.gap', null, '×', qty), h('button.btn.primary', { onclick: go }, 'Search')), quick, custom, status, grid) });
    go();
  },
};
