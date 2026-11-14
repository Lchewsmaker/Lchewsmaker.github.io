/* Deck storage, formats, legality and import / export. */
'use strict';

const FORMATS = {
  freeform:  { name: 'Freeform', min: 0, max: Infinity, copies: Infinity, side: Infinity },
  standard:  { name: 'Standard', min: 60, max: Infinity, copies: 4, side: 15 },
  pioneer:   { name: 'Pioneer', min: 60, max: Infinity, copies: 4, side: 15 },
  modern:    { name: 'Modern', min: 60, max: Infinity, copies: 4, side: 15 },
  legacy:    { name: 'Legacy', min: 60, max: Infinity, copies: 4, side: 15 },
  vintage:   { name: 'Vintage', min: 60, max: Infinity, copies: 4, side: 15 },
  pauper:    { name: 'Pauper', min: 60, max: Infinity, copies: 4, side: 15 },
  historic:  { name: 'Historic', min: 60, max: Infinity, copies: 4, side: 15 },
  timeless:  { name: 'Timeless', min: 60, max: Infinity, copies: 4, side: 15 },
  commander: { name: 'Commander', min: 100, max: 100, copies: 1, side: 0, commander: true },
  duel:      { name: 'Duel Commander', min: 100, max: 100, copies: 1, side: 0, commander: true },
  brawl:     { name: 'Brawl', min: 100, max: 100, copies: 1, side: 0, commander: true, legalKey: 'standardbrawl' },
  oathbreaker: { name: 'Oathbreaker', min: 60, max: 60, copies: 1, side: 0, commander: true },
};
const BOARDS = ['commander', 'main', 'side', 'maybe'];
const BOARD_NAMES = { commander: 'Commander', main: 'Mainboard', side: 'Sideboard', maybe: 'Maybeboard' };
const TYPE_ORDER = ['Creature', 'Planeswalker', 'Battle', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Land', 'Other'];
const BASICS = new Set(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes', 'Snow-Covered Plains', 'Snow-Covered Island', 'Snow-Covered Swamp', 'Snow-Covered Mountain', 'Snow-Covered Forest', 'Snow-Covered Wastes']);

function primaryType(typeLine = '') {
  const front = typeLine.split(' // ')[0];
  for (const t of TYPE_ORDER) if (front.includes(t)) return t;
  return 'Other';
}

const Decks = {
  _decks: null,
  all() {
    if (!this._decks) {
      this._decks = Store.get('decks', null);
      if (!this._decks) { this._decks = []; this._migrateOld(); }
    }
    return this._decks;
  },
  get(id) { return this.all().find(d => d.id === id); },
  save(deck) {
    deck.updated = Date.now();
    const list = this.all(), i = list.findIndex(d => d.id === deck.id);
    if (i >= 0) list[i] = deck; else list.unshift(deck);
    this._persist();
  },
  remove(id) { this._decks = this.all().filter(d => d.id !== id); this._persist(); },
  _persist() { Store.set('decks', this._decks); App?.onDecksChanged?.(); },
  create(name = 'New deck', format = 'freeform') {
    const d = { id: uid(8), name, format, cards: [], updated: Date.now() };
    this.save(d); return d;
  },

  /** Old single-file version stored full Scryfall objects + name->qty map. Convert them once. */
  _migrateOld() {
    try {
      const raw = localStorage.getItem('mtg_arena_deck_library_v1');
      if (!raw) return;
      for (const old of JSON.parse(raw) || []) {
        const cards = (old.cards || []).filter(c => c && c.name).map(c => ({ c: Scry.slim(c), qty: old.quantities?.[c.name] || 1, board: 'main' }));
        this._decks.push({ id: uid(8), name: old.name || 'Imported deck', format: (old.format || 'freeform').toLowerCase() in FORMATS ? old.format.toLowerCase() : 'freeform', cards, updated: Date.now() });
      }
      Store.set('decks', this._decks);
    } catch { /* ignore broken legacy data */ }
  },

  count(deck, board = 'main') { return deck.cards.filter(e => e.board === board).reduce((s, e) => s + e.qty, 0); },
  cover(deck) {
    const e = deck.cards.find(e => e.board === 'commander') || deck.cover && deck.cards.find(e => e.c.id === deck.cover) || deck.cards.find(e => e.board === 'main' && !primaryType(e.c.type).startsWith('Land')) || deck.cards[0];
    return e?.c.art || e?.c.img || '';
  },
  colorIdentity(deck) {
    const cmd = deck.cards.filter(e => e.board === 'commander');
    const src = cmd.length ? cmd : deck.cards.filter(e => e.board === 'main');
    return ['W', 'U', 'B', 'R', 'G'].filter(c => src.some(e => (e.c.ci || []).includes(c)));
  },

  /** Returns {ok, problems[], illegalIds:Set} */
  validate(deck, formatKey = deck.format) {
    const f = FORMATS[formatKey] || FORMATS.freeform, problems = [], illegal = new Set();
    if (formatKey === 'freeform') return { ok: true, problems, illegal };
    const legalKey = f.legalKey || formatKey;
    const main = this.count(deck, 'main'), cmd = this.count(deck, 'commander'), side = this.count(deck, 'side');
    const total = main + cmd;
    if (total < f.min) problems.push(`Deck has ${total} cards; ${f.name} needs ${f.max === f.min ? 'exactly' : 'at least'} ${f.min}.`);
    if (total > f.max) problems.push(`Deck has ${total} cards; ${f.name} allows ${f.max}.`);
    if (side > f.side) problems.push(`Sideboard has ${side} cards; max ${f.side}.`);
    if (f.commander && cmd === 0) problems.push('No commander chosen.');
    const byName = {};
    for (const e of deck.cards) {
      if (e.board === 'maybe') continue;
      byName[e.c.name] = (byName[e.c.name] || 0) + e.qty;
      const st = e.c.legal?.[legalKey];
      if (e.c.legal && !st) { illegal.add(e.c.name); }
      if (st === 'restricted' && byName[e.c.name] > 1) illegal.add(e.c.name);
    }
    for (const [n, q] of Object.entries(byName)) {
      const any = deck.cards.find(e => e.c.name === n)?.c.text?.includes('A deck can have any number of cards named') || /up to (seven|nine)/i.test(deck.cards.find(e => e.c.name === n)?.c.text || '');
      if (!BASICS.has(n) && !any && q > f.copies) { problems.push(`${q}× ${n} (max ${f.copies}).`); illegal.add(n); }
    }
    if (illegal.size) problems.push(`${illegal.size} card(s) not legal in ${f.name}.`);
    if (f.commander && cmd) {
      const ci = new Set(this.colorIdentity(deck));
      for (const e of deck.cards) if (e.board === 'main' && (e.c.ci || []).some(c => !ci.has(c))) { illegal.add(e.c.name); }
      const off = deck.cards.filter(e => e.board === 'main' && (e.c.ci || []).some(c => !ci.has(c)));
      if (off.length) problems.push(`${off.length} card(s) outside the commander's colour identity.`);
    }
    return { ok: problems.length === 0, problems, illegal };
  },

  /* ---------- text import / export ---------- */
  parseList(text) {
    const out = []; let board = 'main';
    const heads = { commander: 'commander', commanders: 'commander', companion: 'side', deck: 'main', main: 'main', mainboard: 'main', sideboard: 'side', side: 'side', maybeboard: 'maybe', maybe: 'maybe', considering: 'maybe' };
    let sawBlankAfterMain = false;
    for (let raw of text.split(/\r?\n/)) {
      let line = raw.trim();
      if (!line) { if (out.some(e => e.board === 'main')) sawBlankAfterMain = true; continue; }
      if (line.startsWith('//') || line.startsWith('#')) {
        const hd = line.replace(/^[/#\s]+/, '').toLowerCase().replace(/[:\s]+$/, '');
        if (heads[hd]) board = heads[hd];
        continue;
      }
      const hd = line.toLowerCase().replace(/[:\s]+$/, '').replace(/\s*\(\d+\)$/, '');
      if (heads[hd]) { board = heads[hd]; sawBlankAfterMain = false; continue; }
      if (/^(about|name)\b/i.test(line)) continue;
      let b = board;
      if (/^SB:\s*/i.test(line)) { b = 'side'; line = line.replace(/^SB:\s*/i, ''); }
      else if (sawBlankAfterMain && board === 'main' && !/commander/i.test(text.slice(0, 40))) b = 'side';
      const m = line.match(/^(\d+)\s*x?\s+(.+?)(?:\s+\(([A-Za-z0-9]{2,6})\)(?:\s+([^\s*]+))?)?(?:\s+\*[A-Z]+\*)*\s*$/i)
        || line.match(/^()(.+?)(?:\s+\(([A-Za-z0-9]{2,6})\)(?:\s+([^\s*]+))?)?\s*$/);
      if (!m) continue;
      out.push({ qty: parseInt(m[1] || '1', 10), name: m[2].trim(), set: m[3]?.toLowerCase(), cn: m[4], board: b });
    }
    return out;
  },

  async resolveList(entries, onProgress) {
    const ids = entries.map(e => e.set && e.cn ? { set: e.set, collector_number: e.cn } : e.set ? { name: e.name, set: e.set } : { name: e.name });
    const { found } = await Scry.collection(ids, onProgress);
    const norm = s => s.toLowerCase().replace(/[^a-z0-9/]/g, '');
    const matches = (card, e) => {
      if (e.set && e.cn && card.set === e.set && card.collector_number === e.cn) return true;
      const n = norm(e.name);
      return (norm(card.name) === n || (card.card_faces || []).some(f => norm(f.name) === n) || norm(card.name.split(' // ')[0]) === norm(e.name.split(' // ')[0]) || norm(card.name.split(' // ')[0]) === norm(e.name.split('/')[0])) && (!e.set || card.set === e.set);
    };
    const resolved = [], missing = [];
    for (const e of entries) {
      let card = found.find(c => matches(c, e));
      if (!card && e.set) card = found.find(c => matches(c, { ...e, set: null }));
      if (!card) {
        try { const r = await Scry.named(e.name); if (r?.object === 'card') card = r; } catch {}
      }
      if (card) resolved.push({ c: Scry.slim(card), qty: e.qty, board: e.board }); else missing.push(e.name);
    }
    return { resolved, missing };
  },

  exportText(deck, style = 'arena') {
    const line = e => style === 'plain' ? `${e.qty} ${e.c.name}` : `${e.qty} ${e.c.name} (${e.c.set.toUpperCase()}) ${e.c.cn}`;
    const sec = b => deck.cards.filter(e => e.board === b).sort((a, b2) => a.c.name.localeCompare(b2.c.name)).map(line);
    const parts = [];
    if (style === 'mtgo') {
      parts.push([...sec('commander'), ...sec('main')].join('\n'));
      if (sec('side').length) parts.push(sec('side').join('\n'));
      return parts.join('\n\n');
    }
    if (sec('commander').length) parts.push('Commander\n' + sec('commander').join('\n'));
    parts.push('Deck\n' + sec('main').join('\n'));
    if (sec('side').length) parts.push('Sideboard\n' + sec('side').join('\n'));
    if (sec('maybe').length && style !== 'arena') parts.push('Maybeboard\n' + sec('maybe').join('\n'));
    return parts.join('\n\n');
  },
};
