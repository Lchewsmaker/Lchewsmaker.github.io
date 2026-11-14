/* Deck builder: Scryfall search, deck editing, printings picker, stats, import/export. */
'use strict';

const Builder = {
  deckId: null,
  results: [],
  next: null,
  dview: 'list',
  group: 'type',
  colorsOn: new Set(),

  init() {
    this.dview = Store.get('b.dview', 'list');
    this.group = Store.get('b.group', 'type');
    $('#b-group').value = this.group;
    $$('[data-dview]').forEach(b => b.classList.toggle('active', b.dataset.dview === this.dview));
    $('#b-deck-format').append(...Object.entries(FORMATS).map(([k, f]) => h('option', { value: k }, f.name)));
    if (Store.get('b.sideCollapsed')) $('#b-side').classList.add('collapsed');

    $('#b-side-toggle').onclick = () => { $('#b-side').classList.toggle('collapsed'); Store.set('b.sideCollapsed', $('#b-side').classList.contains('collapsed')); };
    $('#b-new').onclick = () => { const d = Decks.create('New deck', 'freeform'); this.open(d.id); $('#b-deck-name').select(); };
    $('#b-import').onclick = () => this.importModal();
    $('#b-deck-filter').oninput = () => this.renderDeckList();
    $('#b-search-form').onsubmit = e => { e.preventDefault(); this.hideAC(); this.search(); };
    $('#b-more').onclick = () => this.loadMore();
    $('#b-filters-toggle').onclick = () => {
      const f = $('#b-filters'); f.hidden = !f.hidden; $('#b-filters-toggle').setAttribute('aria-expanded', String(!f.hidden));
    };
    ['W', 'U', 'B', 'R', 'G', 'C'].forEach(c => {
      const b = h('button', { type: 'button', title: c, 'aria-pressed': 'false', 'aria-label': { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', C: 'Colourless' }[c] },
        h('img', { src: `https://svgs.scryfall.io/card-symbols/${c}.svg`, alt: '' }));
      b.onclick = () => { this.colorsOn.has(c) ? this.colorsOn.delete(c) : this.colorsOn.add(c); b.classList.toggle('on'); b.setAttribute('aria-pressed', String(this.colorsOn.has(c))); };
      $('#f-colors').append(b);
    });
    $$('[data-rsize]').forEach(b => b.onclick = () => {
      $$('[data-rsize]').forEach(x => x.classList.toggle('active', x === b));
      $('#b-results').className = 'b-results size-' + b.dataset.rsize; Store.set('b.rsize', b.dataset.rsize);
    });
    const rs = Store.get('b.rsize', 'm'); $(`[data-rsize="${rs}"]`)?.click();
    $$('[data-dview]').forEach(b => b.onclick = () => {
      this.dview = b.dataset.dview; Store.set('b.dview', this.dview);
      $$('[data-dview]').forEach(x => x.classList.toggle('active', x === b)); this.renderDeck();
    });
    $('#b-group').onchange = e => { this.group = e.target.value; Store.set('b.group', this.group); this.renderDeck(); };
    $('#b-deck-name').onchange = e => { const d = this.deck(); if (d) { d.name = e.target.value.trim() || 'Untitled deck'; Decks.save(d); } };
    $('#b-deck-format').onchange = e => { const d = this.deck(); if (d) { d.format = e.target.value; Decks.save(d); this.renderDeck(); } };
    $('#b-export').onclick = () => this.exportModal();
    $('#b-dupe').onclick = () => { const d = this.deck(); if (!d) return; const c = deepClone(d); c.id = uid(8); c.name += ' (copy)'; Decks.save(c); this.open(c.id); toast('Deck duplicated', 'ok'); };
    $('#b-delete').onclick = async () => {
      const d = this.deck(); if (!d) return;
      if (await Modal.confirm('Delete deck', `Delete “${d.name}”? This can't be undone.`, 'Delete', true)) { Decks.remove(d.id); this.deckId = null; this.open(Decks.all()[0]?.id); }
    };
    $('#b-sample').onclick = () => this.sampleHand();
    $('#b-playtest').onclick = () => { const d = this.deck(); if (d) Lobby.startSolo(d.id); };
    this.initAutocomplete();
    this.initDeckDrop();
    this.open(Store.get('b.deck') && Decks.get(Store.get('b.deck')) ? Store.get('b.deck') : Decks.all()[0]?.id);
  },

  deck() { return this.deckId ? Decks.get(this.deckId) : null; },

  open(id) {
    if (!id) { const d = Decks.create('New deck'); id = d.id; }
    this.deckId = id; Store.set('b.deck', id);
    const d = this.deck();
    $('#b-deck-name').value = d.name;
    $('#b-deck-format').value = d.format in FORMATS ? d.format : 'freeform';
    this.renderDeckList(); this.renderDeck();
  },

  renderDeckList() {
    const f = $('#b-deck-filter').value.toLowerCase();
    $('#b-decks').replaceChildren(...Decks.all().filter(d => d.name.toLowerCase().includes(f)).map(d =>
      h('li', null, h('button', { class: d.id === this.deckId ? 'active' : '', onclick: () => this.open(d.id) },
        h('span', null, d.name), h('small', null, `${FORMATS[d.format]?.name || d.format} · ${Decks.count(d, 'main') + Decks.count(d, 'commander')} cards`)))));
  },

  /* ---------------- search ---------------- */
  buildQuery() {
    let q = $('#b-q').value.trim();
    const parts = q ? [q] : [];
    if (this.colorsOn.size) {
      const mode = $('#f-colormode').value, cs = [...this.colorsOn].join('');
      parts.push(mode === 'id<=' ? `id<=${cs}` : `${mode === 'c=' ? 'c=' : 'c>='}${cs}`);
    }
    if ($('#f-type').value) parts.push(($('#f-type').value === 'token' ? 'is:token' : 't:' + $('#f-type').value));
    if ($('#f-format').value) parts.push('f:' + $('#f-format').value);
    if ($('#f-cmcop').value && $('#f-cmc').value !== '') parts.push(`mv${$('#f-cmcop').value}${$('#f-cmc').value}`);
    if ($('#f-rarity').value) parts.push('r:' + $('#f-rarity').value);
    if ($('#f-ci-deck').checked && this.deck()) { const ci = Decks.colorIdentity(this.deck()).join('') || 'c'; parts.push('id<=' + ci); }
    return parts.join(' ');
  },

  async search() {
    const q = this.buildQuery();
    if (!q) { $('#b-result-count').textContent = 'Type something to search.'; return; }
    $('#b-result-count').textContent = 'Searching…';
    try {
      const r = await Scry.search(q, { order: $('#f-order').value, dir: $('#f-dir').value });
      this.results = r.data || []; this.next = r.has_more ? r.next_page : null;
      $('#b-result-count').textContent = r.notFound ? (r.details || 'No cards found.') : `${r.total_cards.toLocaleString()} card${r.total_cards === 1 ? '' : 's'}`;
      this.renderResults();
    } catch (e) { $('#b-result-count').textContent = e.message; }
  },
  async loadMore() {
    if (!this.next) return;
    const r = await Scry.get(this.next);
    this.results.push(...r.data); this.next = r.has_more ? r.next_page : null; this.renderResults();
  },

  renderResults() {
    const d = this.deck();
    $('#b-results').replaceChildren(...this.results.map(raw => {
      const s = Scry.slim(raw);
      const inDeck = d ? d.cards.filter(e => e.c.name === s.name && e.board !== 'maybe').reduce((a, e) => a + e.qty, 0) : 0;
      const el = h('div.r-card', { tabindex: 0, draggable: 'true', role: 'button', 'aria-label': `${s.name}. Enter to add to mainboard.` },
        s.img ? h('img', { src: s.img, alt: s.name, loading: 'lazy' }) : h('div.fallback', null, s.name),
        inDeck ? h('span.r-qty', { title: 'In deck' }, inDeck) : null,
        h('div.r-add', null,
          h('button', { title: 'Add to mainboard', onclick: e => { e.stopPropagation(); this.add(s, 'main'); } }, '+ Main'),
          h('button', { title: 'Add to sideboard', onclick: e => { e.stopPropagation(); this.add(s, 'side'); } }, '+ Side'),
          h('button', { title: 'Choose printing', onclick: e => { e.stopPropagation(); this.printings(s, p => this.add(p, 'main')); } }, 'Prints')));
      el.addEventListener('click', () => this.add(s, 'main'));
      el.addEventListener('keydown', e => { if (e.key === 'Enter') this.add(s, 'main'); });
      el.addEventListener('contextmenu', e => { e.preventDefault(); this.resultMenu(e, s); });
      el.addEventListener('dragstart', e => { e.dataTransfer.setData('application/x-void-card', JSON.stringify(s)); e.dataTransfer.effectAllowed = 'copy'; Preview.hide(); });
      Preview.bind(el, () => s);
      return el;
    }));
    $('#b-more').hidden = !this.next;
  },

  resultMenu(e, s) {
    const add = b => () => this.add(s, b);
    Menu.show(e.clientX, e.clientY, [
      { label: 'Add to mainboard', icon: '+', action: add('main') },
      { label: 'Add 4 to mainboard', icon: '4', action: () => this.add(s, 'main', 4) },
      { label: 'Add to sideboard', icon: '+', action: add('side') },
      { label: 'Add to maybeboard', icon: '?', action: add('maybe') },
      { label: 'Set as commander', icon: '♛', action: add('commander') },
      '-',
      { label: 'Choose a printing…', icon: '⎘', action: () => this.printings(s, p => this.add(p, 'main')) },
      { label: 'Open on Scryfall', icon: '↗', action: () => window.open(s.uri, '_blank', 'noopener') },
    ], s.name);
  },

  initAutocomplete() {
    const inp = $('#b-q'), box = $('#b-ac'); let t, items = [], hi = -1;
    const render = () => { box.replaceChildren(...items.map((n, i) => h('div', { role: 'option', class: i === hi ? 'hi' : '', onmousedown: e => { e.preventDefault(); pick(n); } }, n))); box.hidden = !items.length; };
    const pick = n => { inp.value = `!"${n}"`; this.hideAC(); this.search(); };
    inp.addEventListener('input', () => {
      clearTimeout(t);
      const v = inp.value.trim();
      if (v.length < 2 || /[:<>=!"]/.test(v)) { items = []; render(); return; }
      const seq = this._acSeq = (this._acSeq || 0) + 1;
      t = setTimeout(async () => { const r = (await Scry.autocomplete(v)).slice(0, 12); if (seq !== this._acSeq || document.activeElement !== inp) return; items = r; hi = -1; render(); }, 220);
    });
    inp.addEventListener('keydown', e => {
      if (box.hidden) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); hi = (hi + 1) % items.length; render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); hi = (hi - 1 + items.length) % items.length; render(); }
      else if (e.key === 'Enter' && hi >= 0) { e.preventDefault(); pick(items[hi]); }
      else if (e.key === 'Escape') this.hideAC();
    });
    inp.addEventListener('blur', () => setTimeout(() => this.hideAC(), 120));
  },
  hideAC() { $('#b-ac').hidden = true; this._acSeq = (this._acSeq || 0) + 1; },

  /* ---------------- deck editing ---------------- */
  add(s, board = 'main', qty = 1) {
    const d = this.deck(); if (!d) return;
    const f = FORMATS[d.format] || FORMATS.freeform;
    if (board === 'commander' && f.commander && d.format !== 'freeform' && Decks.count(d, 'commander') >= 2) { toast('A deck can have at most two commanders (partner).', 'err'); return; }
    let e = d.cards.find(x => x.c.id === s.id && x.board === board);
    if (e) e.qty += qty; else d.cards.push(e = { c: s, qty, board });
    if (board === 'commander') e.qty = 1;
    Decks.save(d); this.renderDeck(); this.renderResults(); this.renderDeckList();
    announce(`Added ${s.name} to ${BOARD_NAMES[board]}`);
  },
  setQty(e, q) {
    const d = this.deck(); e.qty = Math.max(0, q);
    if (!e.qty) d.cards.splice(d.cards.indexOf(e), 1);
    Decks.save(d); this.renderDeck(); this.renderResults(); this.renderDeckList();
  },
  moveEntry(e, board, all = true) {
    const d = this.deck(), n = all ? e.qty : 1;
    const target = d.cards.find(x => x.c.id === e.c.id && x.board === board);
    if (target) target.qty += n; else d.cards.push({ c: e.c, qty: board === 'commander' ? 1 : n, board });
    e.qty -= n; if (e.qty <= 0) d.cards.splice(d.cards.indexOf(e), 1);
    Decks.save(d); this.renderDeck(); this.renderDeckList();
  },
  setPrinting(e, p) {
    const d = this.deck();
    const dup = d.cards.find(x => x !== e && x.c.id === p.id && x.board === e.board);
    if (dup) { dup.qty += e.qty; d.cards.splice(d.cards.indexOf(e), 1); } else e.c = p;
    Decks.save(d); this.renderDeck();
    toast(`${p.name} → ${p.setName} #${p.cn}`, 'ok');
  },

  groupKey(e) {
    if (this.group === 'cmc') return primaryType(e.c.type) === 'Land' ? 'Lands' : `Mana value ${Math.min(7, Math.floor(e.c.cmc))}${e.c.cmc >= 7 ? '+' : ''}`;
    if (this.group === 'color') { const c = e.c.colors || []; return c.length === 0 ? (primaryType(e.c.type) === 'Land' ? 'Lands' : 'Colourless') : c.length > 1 ? 'Multicolour' : { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' }[c[0]]; }
    if (this.group === 'none') return 'Cards';
    return primaryType(e.c.type);
  },

  renderDeck() {
    const d = this.deck(), body = $('#b-deck-body');
    if (!d) { body.replaceChildren(); return; }
    const v = Decks.validate(d);
    const frag = [];
    for (const board of BOARDS) {
      const entries = d.cards.filter(e => e.board === board);
      const isCmdFmt = FORMATS[d.format]?.commander;
      if (!entries.length && board === 'commander' && !isCmdFmt) continue;
      if (!entries.length && board === 'maybe') { frag.push(this.sectionEl(board, `${BOARD_NAMES[board]}`, [], v)); continue; }
      const total = entries.reduce((s, e) => s + e.qty, 0);
      if (board === 'main' && this.group !== 'none') {
        const groups = {};
        entries.forEach(e => (groups[this.groupKey(e)] ||= []).push(e));
        const order = Object.keys(groups).sort((a, b) => {
          const ia = TYPE_ORDER.indexOf(a), ib = TYPE_ORDER.indexOf(b);
          if (ia >= 0 && ib >= 0) return ia - ib;
          if (a === 'Lands') return 1; if (b === 'Lands') return -1;
          return a.localeCompare(b, undefined, { numeric: true });
        });
        frag.push(h('div.muted.small', { style: { margin: '.4rem 0 0', fontWeight: 700 } }, `MAINBOARD · ${total}`));
        for (const g of order) frag.push(this.sectionEl('main', `${g} (${groups[g].reduce((s, e) => s + e.qty, 0)})`, groups[g], v, 'main:' + g));
      } else {
        frag.push(this.sectionEl(board, `${BOARD_NAMES[board]} (${total})`, entries, v));
      }
    }
    body.replaceChildren(...frag);
    this.renderStats(d, v);
  },

  sectionEl(board, title, entries, v, key = board) {
    const collapsed = Store.get('b.collapsedSecs', {})[key];
    const sec = h('div.d-sec' + (collapsed ? '.collapsed' : ''), { dataset: { board } });
    const head = h('h4', { tabindex: 0, role: 'button', 'aria-expanded': String(!collapsed) }, title);
    const toggle = () => { sec.classList.toggle('collapsed'); const s = Store.get('b.collapsedSecs', {}); s[key] = sec.classList.contains('collapsed'); Store.set('b.collapsedSecs', s); head.setAttribute('aria-expanded', String(!s[key])); };
    head.onclick = toggle; head.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } };
    const items = h('div.d-items' + (this.dview === 'visual' ? '.d-visual' : ''));
    entries.sort((a, b) => a.c.cmc - b.c.cmc || a.c.name.localeCompare(b.c.name));
    for (const e of entries) items.append(this.dview === 'visual' ? this.visualEl(e) : this.rowEl(e, v));
    if (!entries.length) items.append(h('div.muted.small', { style: { padding: '.3rem' } }, board === 'commander' ? 'Right-click a card → “Set as commander”, or drag one here.' : 'Drag cards here.'));
    sec.append(head, items);
    return sec;
  },

  rowEl(e, v) {
    const row = h('div.d-row', { draggable: 'true' },
      h('div.qty', null,
        h('button', { 'aria-label': `Remove one ${e.c.name}`, onclick: () => this.setQty(e, e.qty - 1) }, '−'),
        h('b', null, e.qty),
        h('button', { 'aria-label': `Add one ${e.c.name}`, onclick: () => this.setQty(e, e.qty + 1) }, '+')),
      h('span.nm' + (v.illegal.has(e.c.name) ? '.illegal' : ''), { title: v.illegal.has(e.c.name) ? 'Not legal in this format' : '' }, e.c.name),
      h('span', { html: manaHTML(e.c.mana) }),
      h('button.set-btn', { title: `${e.c.setName || ''} #${e.c.cn} — change printing`, onclick: () => this.printings(e.c, p => this.setPrinting(e, p)) }, e.c.set));
    Preview.bind(row, () => e.c);
    row.addEventListener('contextmenu', ev => { ev.preventDefault(); this.entryMenu(ev, e); });
    row.addEventListener('dragstart', ev => { ev.dataTransfer.setData('application/x-void-entry', e.c.id + '|' + e.board); Preview.hide(); });
    return row;
  },
  visualEl(e) {
    const el = h('div.vcard', { tabindex: 0, draggable: 'true', 'aria-label': `${e.qty} ${e.c.name}` }, h('img', { src: e.c.img, alt: e.c.name, loading: 'lazy' }), h('b', null, e.qty + '×'));
    Preview.bind(el, () => e.c);
    el.addEventListener('click', () => this.printings(e.c, p => this.setPrinting(e, p)));
    el.addEventListener('contextmenu', ev => { ev.preventDefault(); this.entryMenu(ev, e); });
    el.addEventListener('dragstart', ev => { ev.dataTransfer.setData('application/x-void-entry', e.c.id + '|' + e.board); Preview.hide(); });
    return el;
  },

  entryMenu(ev, e) {
    const d = this.deck();
    const moveTo = BOARDS.filter(b => b !== e.board).map(b => ({ label: BOARD_NAMES[b], action: () => this.moveEntry(e, b) }));
    Menu.show(ev.clientX, ev.clientY, [
      { label: 'Add one', icon: '+', action: () => this.setQty(e, e.qty + 1) },
      { label: 'Remove one', icon: '−', action: () => this.setQty(e, e.qty - 1) },
      { label: 'Set quantity…', icon: '#', action: async () => { const n = await Modal.number('Quantity', e.c.name, e.qty); if (n != null) this.setQty(e, n); } },
      { label: 'Remove all', icon: '✕', action: () => this.setQty(e, 0) },
      '-',
      { label: 'Move all to', icon: '→', sub: moveTo },
      { label: 'Move one to', icon: '→', sub: BOARDS.filter(b => b !== e.board).map(b => ({ label: BOARD_NAMES[b], action: () => this.moveEntry(e, b, false) })) },
      '-',
      { label: 'Change printing…', icon: '⎘', action: () => this.printings(e.c, p => this.setPrinting(e, p)) },
      { label: 'Use as deck cover', icon: '🖼', action: () => { d.cover = e.c.id; Decks.save(d); toast('Cover updated', 'ok'); } },
      { label: 'Copy name', icon: '⧉', action: () => copyText(e.c.name) },
      { label: 'Open on Scryfall', icon: '↗', action: () => window.open(e.c.uri, '_blank', 'noopener') },
    ], e.c.name);
  },

  initDeckDrop() {
    const body = $('#b-deck-body');
    body.addEventListener('dragover', ev => {
      if (![...ev.dataTransfer.types].some(t => t.startsWith('application/x-void'))) return;
      ev.preventDefault();
      $$('.d-sec.drop-hi').forEach(s => s.classList.remove('drop-hi'));
      ev.target.closest('.d-sec')?.classList.add('drop-hi');
    });
    body.addEventListener('dragleave', ev => { if (!body.contains(ev.relatedTarget)) $$('.d-sec.drop-hi').forEach(s => s.classList.remove('drop-hi')); });
    body.addEventListener('drop', ev => {
      ev.preventDefault();
      const sec = ev.target.closest('.d-sec'); $$('.d-sec.drop-hi').forEach(s => s.classList.remove('drop-hi'));
      const board = sec?.dataset.board || 'main';
      const card = ev.dataTransfer.getData('application/x-void-card');
      if (card) { this.add(JSON.parse(card), board); return; }
      const ent = ev.dataTransfer.getData('application/x-void-entry');
      if (ent) {
        const [id, from] = ent.split('|');
        const e = this.deck().cards.find(x => x.c.id === id && x.board === from);
        if (e && from !== board) this.moveEntry(e, board);
      }
    });
  },

  renderStats(d, v) {
    const main = d.cards.filter(e => e.board === 'main' || e.board === 'commander');
    const total = main.reduce((s, e) => s + e.qty, 0);
    $('#b-count').textContent = `${total} cards` + (Decks.count(d, 'side') ? ` · ${Decks.count(d, 'side')} side` : '');
    const legal = $('#b-legal');
    if (d.format === 'freeform') { legal.textContent = 'Freeform'; legal.className = 'pill'; legal.title = ''; }
    else { legal.textContent = v.ok ? `✓ ${FORMATS[d.format].name} legal` : `✕ ${v.problems.length} issue${v.problems.length > 1 ? 's' : ''}`; legal.className = 'pill ' + (v.ok ? 'ok' : 'bad'); legal.title = v.problems.join('\n'); }
    const nonland = main.filter(e => primaryType(e.c.type) !== 'Land');
    const curve = Array(8).fill(0); nonland.forEach(e => curve[Math.min(7, Math.floor(e.c.cmc))] += e.qty);
    const max = Math.max(1, ...curve);
    $('#b-curve').replaceChildren(...curve.map((n, i) => h('div.bar', { style: { height: (n / max * 100) + '%' }, title: `${n} card(s) at ${i}${i === 7 ? '+' : ''}` }, h('em', null, n || ''), h('span', null, i === 7 ? '7+' : i))));
    $('#b-curve').setAttribute('aria-label', 'Mana curve: ' + curve.map((n, i) => `${n} at ${i}`).join(', '));
    const pips = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
    main.forEach(e => (e.c.mana?.match(/\{[^}]+\}/g) || []).forEach(s => { for (const c of 'WUBRGC') if (s.includes(c)) pips[c] += e.qty; }));
    $('#b-pips').replaceChildren(...Object.entries(pips).filter(([, n]) => n).map(([c, n]) => h('div', null, h('img', { src: `https://svgs.scryfall.io/card-symbols/${c}.svg`, alt: c }), n)));
    const types = {}; main.forEach(e => types[primaryType(e.c.type)] = (types[primaryType(e.c.type)] || 0) + e.qty);
    $('#b-types').innerHTML = TYPE_ORDER.filter(t => types[t]).map(t => `${t}: <b>${types[t]}</b>`).join('<br>');
    const nlCount = nonland.reduce((s, e) => s + e.qty, 0);
    $('#b-avg').textContent = nlCount ? (nonland.reduce((s, e) => s + e.c.cmc * e.qty, 0) / nlCount).toFixed(2) : '–';
    const price = d.cards.filter(e => e.board !== 'maybe').reduce((s, e) => s + (parseFloat(e.c.usd) || 0) * e.qty, 0);
    $('#b-price').textContent = price ? '$' + price.toFixed(2) : '–';
  },

  /* ---------------- printings picker ---------------- */
  async printings(card, onPick) {
    const grid = h('div.prints', null, h('p.muted', null, 'Loading printings from Scryfall…'));
    const filt = h('input', { placeholder: 'Filter by set name or code…', style: { flex: 1 } });
    const sortSel = h('select', null, h('option', { value: 'new' }, 'Newest first'), h('option', { value: 'old' }, 'Oldest first'), h('option', { value: 'cheap' }, 'Cheapest'), h('option', { value: 'set' }, 'Set name'));
    const kindSel = h('select', null, h('option', { value: '' }, 'All treatments'), h('option', { value: 'nonfoil' }, 'Regular frame'), h('option', { value: 'full' }, 'Full art / borderless'), h('option', { value: 'promo' }, 'Promos'));
    const m = Modal.open({ title: `Printings — ${card.name}`, size: 'wide', body: h('div', null, h('div.prints-filter', null, filt, kindSel, sortSel), grid) });
    let prints;
    try { prints = (await Scry.prints(card)).map(p => ({ raw: p, s: Scry.slim(p) })); }
    catch (e) { grid.replaceChildren(h('p', null, 'Could not load printings: ' + e.message)); return; }
    const render = () => {
      const f = filt.value.toLowerCase(), k = kindSel.value;
      let list = prints.filter(({ raw, s }) => (!f || s.setName.toLowerCase().includes(f) || s.set.includes(f)) &&
        (!k || (k === 'full' ? raw.full_art || raw.border_color === 'borderless' || (raw.frame_effects || []).includes('extendedart') : k === 'promo' ? raw.promo : !raw.full_art && raw.border_color !== 'borderless' && !raw.promo)));
      const so = sortSel.value;
      list = [...list].sort((a, b) => so === 'old' ? a.s.released.localeCompare(b.s.released) : so === 'cheap' ? (parseFloat(a.s.usd) || 1e9) - (parseFloat(b.s.usd) || 1e9) : so === 'set' ? a.s.setName.localeCompare(b.s.setName) : b.s.released.localeCompare(a.s.released));
      grid.replaceChildren(...list.map(({ s }) => {
        const el = h('button.print' + (s.id === card.id ? '.current' : ''), { title: `${s.setName} (${s.set.toUpperCase()}) #${s.cn}`, onclick: () => { m.close(); onPick(s); } },
          h('img', { src: s.img, alt: `${s.name} from ${s.setName}`, loading: 'lazy' }),
          h('div.pmeta', null, h('b', null, s.setName), `${s.set.toUpperCase()} #${s.cn} · ${s.released?.slice(0, 4) || ''}${s.usd ? ' · $' + s.usd : ''}`));
        Preview.bind(el, () => s);
        return el;
      }));
      if (!list.length) grid.append(h('p.muted', null, 'No printings match.'));
    };
    filt.oninput = render; sortSel.onchange = render; kindSel.onchange = render;
    render();
  },

  /* ---------------- import / export ---------------- */
  importModal() {
    const ta = h('textarea.mono', { placeholder: 'Paste a deck list (Arena, MTGO, Moxfield, Archidekt…)\n\nCommander\n1 Atraxa, Praetors\' Voice (2X2) 190\n\nDeck\n1 Sol Ring\n4 Lightning Bolt (2XM) 141\n\nSideboard\n2 Pyroblast' });
    const name = h('input', { placeholder: 'Deck name', value: 'Imported deck' });
    const fmt = h('select', null, Object.entries(FORMATS).map(([k, f]) => h('option', { value: k }, f.name)));
    const into = h('select', null, h('option', { value: 'new' }, 'Create a new deck'), h('option', { value: 'replace' }, 'Replace current deck'), h('option', { value: 'merge' }, 'Add to current deck'));
    const status = h('p.muted.small');
    const file = h('input', { type: 'file', accept: '.txt,.dec,.dek,.csv,text/plain' });
    file.onchange = async () => { ta.value = await file.files[0].text(); name.value = file.files[0].name.replace(/\.[^.]+$/, ''); };
    const go = h('button.btn.primary', null, 'Import');
    const m = Modal.open({ title: 'Import deck', body: h('div', null,
      h('div.grid2', null, h('label.field', null, h('span', null, 'Name'), name), h('label.field', null, h('span', null, 'Format'), fmt)),
      h('label.field', null, h('span', null, 'Destination'), into),
      h('label.field', null, h('span', null, 'Deck list'), ta),
      h('label.field', null, h('span', null, '…or load a file'), file), status),
      foot: [h('button.btn.ghost', { onclick: () => m.close() }, 'Cancel'), go] });
    go.onclick = async () => {
      const entries = Decks.parseList(ta.value);
      if (!entries.length) { status.textContent = 'No cards recognised.'; return; }
      go.disabled = true; status.textContent = `Looking up ${entries.length} cards on Scryfall…`;
      try {
        const { resolved, missing } = await Decks.resolveList(entries, (a, b) => status.textContent = `Looking up cards… ${a}/${b}`);
        let d;
        if (into.value === 'new') { d = Decks.create(name.value.trim() || 'Imported deck', fmt.value); d.cards = []; }
        else { d = this.deck(); if (into.value === 'replace') d.cards = []; }
        if (entries.some(e => e.board === 'commander') && !FORMATS[d.format]?.commander) d.format = 'commander';
        for (const r of resolved) {
          const ex = d.cards.find(x => x.c.id === r.c.id && x.board === r.board);
          if (ex) ex.qty += r.qty; else d.cards.push(r);
        }
        Decks.save(d); m.close(); this.open(d.id);
        toast(`Imported ${resolved.reduce((s, r) => s + r.qty, 0)} cards` + (missing.length ? ` — ${missing.length} not found` : ''), missing.length ? 'err' : 'ok', 6000);
        if (missing.length) Modal.open({ title: 'Cards not found', size: 'narrow', body: h('ul', null, missing.map(n => h('li', null, n))) });
      } catch (e) { status.textContent = 'Import failed: ' + e.message; go.disabled = false; }
    };
  },

  exportModal() {
    const d = this.deck(); if (!d) return;
    const ta = h('textarea.mono', { readonly: true });
    const style = h('select', null, h('option', { value: 'arena' }, 'Arena / Moxfield (with printings)'), h('option', { value: 'full' }, 'With printings + maybeboard'), h('option', { value: 'plain' }, 'Plain text (names only)'), h('option', { value: 'mtgo' }, 'MTGO (.txt)'));
    const upd = () => ta.value = Decks.exportText(d, style.value);
    style.onchange = upd; upd();
    Modal.open({ title: `Export — ${d.name}`, body: h('div', null, h('label.field', null, h('span', null, 'Format'), style), ta),
      foot: [h('button.btn', { onclick: () => downloadText(d.name.replace(/[^\w-]+/g, '_') + '.txt', ta.value) }, 'Download .txt'), h('button.btn.primary', { onclick: () => copyText(ta.value) }, 'Copy')] });
  },

  sampleHand() {
    const d = this.deck(); if (!d) return;
    const lib = shuffle(d.cards.filter(e => e.board === 'main').flatMap(e => Array(e.qty).fill(e.c)));
    if (!lib.length) { toast('Add some cards first', 'err'); return; }
    let n = 7;
    const wrap = h('div.sample-hand');
    const render = () => { wrap.replaceChildren(...lib.slice(0, n).map(c => { const i = h('img', { src: c.img, alt: c.name }); Preview.bind(i, () => c); return i; })); };
    render();
    Modal.open({ title: 'Sample hand', size: 'wide', body: wrap, foot: [
      h('button.btn', { onclick: () => { n++; render(); } }, 'Draw a card'),
      h('button.btn.primary', { onclick: () => { shuffle(lib); n = 7; render(); } }, 'New hand')] });
  },
};
