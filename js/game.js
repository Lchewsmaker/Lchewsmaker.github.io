/* Game engine: my private state, public state sync, actions, turns. Rendering lives in board.js. */
'use strict';

const PHASES = ['Untap', 'Upkeep', 'Draw', 'Main 1', 'Combat', 'Main 2', 'End'];
const ZONES = ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'];
const ZONE_LABEL = { library: 'library', hand: 'hand', battlefield: 'battlefield', graveyard: 'graveyard', exile: 'exile', command: 'command zone', sideboard: 'sideboard' };
const BW = 1400, BH = 760, HEAD = 52, PILES = 140, FW = BW - PILES, FH = BH - HEAD, CW = 100, CH = 140;

const Game = {
  active: false, online: false,
  mode: 'duel', M: MODES.duel, settings: {}, me: 'me', seating: [], first: null,
  info: {},     // pid -> {name, color}
  pub: {},      // pid -> public state (others; mine is derived)
  my: null,
  deckSrc: null, // {main:[], side:[], cmd:[]} lists of gameCards for restarts / sideboarding
  turn: { active: null, n: 1, phase: 0 },
  global: { monarch: null, initiative: null, day: null, blessing: {} },
  arrows: [],
  undoStack: [],
  match: { wins: {}, game: 1 },
  clocks: {}, clockStart: 0,
  z: 10,

  /* ---------------- setup ---------------- */
  start({ mode, settings, players, seating, first, me, deck, online }) {
    this.active = true; this.online = online;
    this.mode = mode; this.M = MODES[mode]; this.settings = { ...settings };
    this.me = me; this.seating = seating; this.first = first;
    this.info = {}; this.pub = {}; this.arrows = []; this.undoStack = [];
    players.forEach(p => (this.info[p.id] = { name: p.name, color: p.color }));
    this.global = { monarch: null, initiative: null, day: null, blessing: {} };
    this.match = { wins: Object.fromEntries(seating.map(p => [p, 0])), game: 1 };
    const toList = b => deck.cards.filter(e => e.board === b).flatMap(e => Array(e.qty).fill(Scry.gameCard(e.c)));
    this.deckSrc = { main: toList('main'), side: toList('side'), cmd: toList('commander') };
    this.deckName = deck.name;
    this.clocks = Object.fromEntries(seating.map(p => [p, (settings.timerMin || 20) * 60000]));
    this.newGame(true);
    this.turn = { active: first, n: 1, phase: 3 };
    this.clockStart = Date.now();
    Board.setup();
    App.show('game');
    this.log(`Game started — ${this.M.name}. ${this.name(first)} goes first.`, 'game', true);
  },

  newGame(initial) {
    const mk = c => ({ iid: uid(9), c, x: 0, y: 0, tapped: false, faceDown: false, flipped: false, counters: {}, z: 0 });
    this.my = {
      library: shuffle(this.deckSrc.main.map(mk)), hand: [], battlefield: [], graveyard: [], exile: [],
      command: this.deckSrc.cmd.map(c => ({ ...mk(c), cmd: true, casts: 0 })),
      sideboard: this.deckSrc.side.map(mk),
      life: +this.settings.life || this.M.life, poison: 0, energy: 0, exp: 0, rad: 0, custom: {}, cmdDmg: {},
      handRevealed: false, topRevealed: false, mulligans: 0, kept: (this.settings.mulligan === 'none'), dead: false, lifeHistory: [],
    };
    this.draw(+this.settings.hand || 7, { silent: true, noUndo: true });
    this.undoStack = [];
    if (!initial) { this.log(`${this.myName()} started a new game (game ${this.match.game}).`); Board.updateAll(); }
    this.sync(true);
  },

  /* ---------------- helpers ---------------- */
  name(pid) { return this.info[pid]?.name || 'Someone'; },
  myName() { return this.name(this.me); },
  color(pid) { return Settings.playerColor(this.info[pid]?.color || '#888', this.seating.indexOf(pid)); },
  team(pid) { return this.seating.indexOf(pid) % 2; },
  isActive(pid) { return this.M.teams ? this.team(pid) === this.team(this.turn.active) : pid === this.turn.active; },
  others() { const i = this.seating.indexOf(this.me); return [...this.seating.slice(i + 1), ...this.seating.slice(0, i)]; },
  find(iid) {
    for (const z of [...ZONES, 'sideboard']) { const i = this.my[z].findIndex(c => c.iid === iid); if (i >= 0) return { zone: z, idx: i, card: this.my[z][i] }; }
    return null;
  },
  cardName(inst, zoneFrom, zoneTo) {
    if (inst.faceDown && zoneTo !== 'graveyard' && zoneTo !== 'hand') return 'a face-down card';
    if ((zoneFrom === 'hand' || zoneFrom === 'library') && (zoneTo === 'library' || zoneTo === 'hand')) return 'a card';
    if (zoneFrom === 'library' && zoneTo === 'exile' && inst.faceDown) return 'a card';
    return inst.c.name;
  },

  /* ---------------- public state ---------------- */
  publicOf() {
    const m = this.my;
    const vis = c => ({ ...c, c: c.faceDown ? null : c.c });
    return {
      life: m.life, poison: m.poison, energy: m.energy, exp: m.exp, rad: m.rad, custom: m.custom, cmdDmg: m.cmdDmg,
      handCount: m.hand.length, libCount: m.library.length, sideCount: m.sideboard.length,
      battlefield: m.battlefield.map(vis), graveyard: m.graveyard, exile: m.exile.map(vis), command: m.command,
      hand: m.handRevealed ? m.hand : m.hand.filter(c => c.revealed).length ? m.hand.map(c => c.revealed ? c : { iid: c.iid, c: null }) : null,
      top: m.topRevealed && m.library[0] ? m.library[0] : null,
      dead: m.dead, mulligans: m.mulligans, kept: m.kept,
      commanders: [...m.command, ...m.battlefield, ...m.graveyard, ...m.exile, ...m.hand, ...m.library].filter(c => c.cmd).map(c => ({ iid: c.iid, name: c.c.name, art: c.c.img })),
      deckName: this.deckName,
    };
  },
  state(pid) { return pid === this.me ? this.publicOf() : this.pub[pid]; },

  _syncT: null,
  sync(now) {
    Board.update(this.me);
    clearTimeout(this._syncT);
    const send = () => Net.broadcast('pstate', { state: this.publicOf() });
    if (now) send(); else this._syncT = setTimeout(send, 40);
  },

  pushUndo() { this.undoStack.push(JSON.stringify(this.my)); if (this.undoStack.length > 50) this.undoStack.shift(); },
  undo() {
    const s = this.undoStack.pop();
    if (!s) { toast('Nothing to undo'); return; }
    this.my = JSON.parse(s); this.sync(); this.log(`${this.myName()} undid an action.`);
  },

  /* ---------------- logging & chat ---------------- */
  log(text, kind = 'game', remote = false) {
    Board.addLog(text, kind);
    announce(text);
    if (!remote) Net.broadcast('log', { text, kind });
  },
  chat(text) {
    text = text.trim().slice(0, 400); if (!text) return;
    if (text.startsWith('/')) return this.command(text);
    this.log(`${this.myName()}: ${text}`, 'chat');
  },
  command(t) {
    const [cmd, arg] = t.slice(1).split(/\s+/, 2);
    if (cmd === 'roll' || cmd === 'r') { const n = parseInt((arg || 'd20').replace(/^d/, ''), 10) || 20; this.roll(n); }
    else if (cmd === 'flip') this.flipCoin();
    else if (cmd === 'draw') this.draw(parseInt(arg, 10) || 1);
    else if (cmd === 'life') { const n = parseInt(arg, 10); if (Number.isFinite(n)) this.setLife(n - this.my.life); }
    else toast('Commands: /roll d20, /flip, /draw N, /life N');
  },

  /* ---------------- zone movement ---------------- */
  move(iid, to, opts = {}) {
    const f = this.find(iid); if (!f) return;
    if (!opts.noUndo) this.pushUndo();
    const { zone: from, card } = f;
    if (from === to && to !== 'battlefield' && to !== 'library' && to !== 'hand') return;
    this.my[from].splice(f.idx, 1);

    if (card.token && to !== 'battlefield') {
      if (!opts.silent) this.log(`${this.myName()}'s token ${card.c.name} left the battlefield.`);
      this.sync(); return;
    }
    // leaving the battlefield resets permanent state
    if (from === 'battlefield' && to !== 'battlefield') { card.tapped = false; card.counters = {}; card.flipped = false; card.note = ''; card.pt = ''; card.dnu = false; card.attachTo = null; }
    if (to !== 'battlefield' && to !== 'exile') card.faceDown = false;
    if (to === 'exile' && opts.faceDown) card.faceDown = true;
    if (to === 'battlefield') card.faceDown = !!opts.faceDown || (from === 'battlefield' ? card.faceDown : false);
    if (opts.tapped != null) card.tapped = opts.tapped;
    if (to !== 'hand') card.revealed = false;
    if (from === 'command' && to === 'battlefield' && card.cmd) {
      card.casts = (card.casts || 0) + 1;
      if (!opts.silent) this.log(`${this.myName()} cast ${card.c.name} from the command zone (cast #${card.casts}; tax is now ${card.casts * 2}).`);
    }
    if (to === 'battlefield') {
      if (opts.x != null) { card.x = opts.x; card.y = opts.y; } else if (from !== 'battlefield') Object.assign(card, this.freeSpot(card));
      card.x = clamp(card.x, 0, FW - CW); card.y = clamp(card.y, 0, FH - CH);
      card.z = ++this.z;
    }
    const list = this.my[to];
    if (to === 'library') {
      const pos = opts.pos ?? 'top';
      if (pos === 'top') list.unshift(card); else if (pos === 'bottom') list.push(card);
      else list.splice(clamp(pos, 0, list.length), 0, card);
    } else if (to === 'hand' && opts.index != null) list.splice(clamp(opts.index, 0, list.length), 0, card);
    else list.push(card);

    if (!opts.silent && from !== to && !(from === 'command' && to === 'battlefield' && card.cmd)) {
      const nm = this.cardName(card, from, to);
      const where = to === 'library' ? ((opts.pos ?? 'top') === 'top' ? 'top of library' : opts.pos === 'bottom' ? 'bottom of library' : `library (${opts.pos + 1} from top)`) : ZONE_LABEL[to];
      const verb = from === 'hand' && to === 'battlefield' ? (card.faceDown ? 'played a card face down' : `played ${nm}`) : `moved ${nm} from ${ZONE_LABEL[from]} to ${where}`;
      this.log(`${this.myName()} ${verb}.`);
    }
    if (card.cmd && from === 'battlefield' && ['graveyard', 'exile', 'hand', 'library'].includes(to) && Settings.get('cmdToZonePrompt'))
      toast(`${card.c.name} went to ${ZONE_LABEL[to]}.`, '', 9000, { label: 'Move to command zone', fn: () => this.move(card.iid, 'command') });
    Sound.play(to === 'battlefield' ? 'drop' : 'draw');
    this.sync();
  },

  moveMany(iids, to, opts = {}) {
    if (!iids.length) return;
    this.pushUndo();
    iids.forEach(i => this.move(i, to, { ...opts, noUndo: true, silent: iids.length > 1 }));
    if (iids.length > 1) this.log(`${this.myName()} moved ${iids.length} cards to ${ZONE_LABEL[to]}.`);
  },

  freeSpot(card) {
    const land = /Land/.test(card.c?.type?.split(' // ')[0] || '') && !/Creature/.test(card.c?.type || '');
    const occupied = this.my.battlefield;
    const y0 = land ? Math.round(FH * .68) : 12, y1 = land ? FH - CH : Math.round(FH * .66) - CH;
    for (let y = y0; y <= y1; y += CH + 12)
      for (let x = 12; x <= FW - CW - 8; x += CW + 12)
        if (!occupied.some(o => Math.abs(o.x - x) < CW * .7 && Math.abs(o.y - y) < CH * .7)) return { x, y };
    return { x: 12 + (occupied.length * 18) % (FW - CW - 24), y: y0 + (occupied.length * 9) % 60 };
  },

  updateCard(iid, patch, logText) {
    const f = this.find(iid); if (!f) return;
    this.pushUndo(); Object.assign(f.card, patch);
    if (logText) this.log(logText);
    this.sync();
  },

  /* ---------------- core actions ---------------- */
  draw(n = 1, { silent, noUndo } = {}) {
    if (!noUndo) this.pushUndo();
    let drawn = 0;
    for (let i = 0; i < n; i++) { const c = this.my.library.shift(); if (!c) { toast('Your library is empty!', 'err'); break; } c.faceDown = false; this.my.hand.push(c); drawn++; }
    if (drawn && !silent) { this.log(`${this.myName()} drew ${drawn === 1 ? 'a card' : drawn + ' cards'}.`); Sound.play('draw'); }
    this.sync();
  },
  shuffleLibrary(silent) {
    this.pushUndo(); shuffle(this.my.library);
    if (!silent) this.log(`${this.myName()} shuffled their library.`);
    Sound.play('shuffle'); this.sync();
  },
  mill(n = 1) {
    this.pushUndo();
    const cards = this.my.library.splice(0, n); this.my.graveyard.push(...cards);
    if (cards.length) this.log(`${this.myName()} milled ${cards.map(c => c.c.name).join(', ')}.`);
    this.sync();
  },
  exileTop(n = 1, faceDown = false) {
    this.pushUndo();
    const cards = this.my.library.splice(0, n); cards.forEach(c => (c.faceDown = faceDown)); this.my.exile.push(...cards);
    this.log(`${this.myName()} exiled the top ${n === 1 ? 'card' : n + ' cards'} of their library${faceDown ? ' face down' : ': ' + cards.map(c => c.c.name).join(', ')}.`);
    this.sync();
  },
  untapAll(silent) {
    this.pushUndo();
    this.my.battlefield.forEach(c => { if (!c.dnu) c.tapped = false; });
    if (!silent) this.log(`${this.myName()} untapped all permanents.`);
    this.sync();
  },
  toggleTap(iids, force) {
    this.pushUndo();
    const cards = iids.map(i => this.find(i)).filter(f => f?.zone === 'battlefield').map(f => f.card);
    if (!cards.length) return;
    const to = force ?? !cards[0].tapped;
    cards.forEach(c => (c.tapped = to));
    this.log(`${this.myName()} ${to ? 'tapped' : 'untapped'} ${cards.length === 1 ? this.cardName(cards[0], 'battlefield', 'battlefield') : cards.length + ' permanents'}.`);
    Sound.play('tap'); this.sync();
  },
  flip(iid) {
    const f = this.find(iid); if (!f) return;
    if (!f.card.c.back) { this.updateCard(iid, { flip180: !f.card.flip180 }, `${this.myName()} turned ${f.card.c.name} upside down.`); return; }
    this.updateCard(iid, { flipped: !f.card.flipped }, `${this.myName()} transformed ${f.card.flipped ? f.card.c.faceNames?.[0] : f.card.c.faceNames?.[1] || f.card.c.name}.`);
  },
  faceDown(iid) {
    const f = this.find(iid); if (!f) return;
    const down = !f.card.faceDown;
    this.updateCard(iid, { faceDown: down }, down ? `${this.myName()} turned ${f.card.c.name} face down.` : `${this.myName()} turned a card face up: ${f.card.c.name}.`);
  },
  addCounter(iids, kind, delta) {
    this.pushUndo();
    for (const iid of iids) {
      const f = this.find(iid); if (!f) continue;
      const cur = (f.card.counters[kind] || 0) + delta;
      if (cur <= 0) delete f.card.counters[kind]; else f.card.counters[kind] = cur;
      // +1/+1 and -1/-1 counters annihilate
      const p = f.card.counters['+1/+1'] || 0, m = f.card.counters['-1/-1'] || 0;
      if (p && m) { const k = Math.min(p, m); f.card.counters['+1/+1'] = p - k; f.card.counters['-1/-1'] = m - k; if (!f.card.counters['+1/+1']) delete f.card.counters['+1/+1']; if (!f.card.counters['-1/-1']) delete f.card.counters['-1/-1']; }
    }
    const one = this.find(iids[0]);
    this.log(`${this.myName()} ${delta > 0 ? 'put' : 'removed'} ${Math.abs(delta)} ${kind} counter${Math.abs(delta) > 1 ? 's' : ''} ${delta > 0 ? 'on' : 'from'} ${iids.length > 1 ? iids.length + ' cards' : one ? this.cardName(one.card, 'battlefield', 'battlefield') : 'a card'}.`);
    this.sync();
  },
  clone(iid) {
    const f = this.find(iid); if (!f) return;
    this.pushUndo();
    const c = { ...deepClone(f.card), iid: uid(9), token: true, cmd: false, tapped: false, x: f.card.x + 24, y: f.card.y + 24, z: ++this.z, counters: {} };
    this.my.battlefield.push(c);
    this.log(`${this.myName()} created a token copy of ${f.card.c.name}.`); this.sync();
  },
  createToken(gameCard, n = 1, pos) {
    this.pushUndo();
    for (let i = 0; i < n; i++) {
      const c = { iid: uid(9), c: gameCard, token: true, tapped: false, faceDown: false, counters: {}, z: ++this.z };
      Object.assign(c, pos ? { x: clamp(pos.x + i * 22, 0, FW - CW), y: clamp(pos.y + i * 22, 0, FH - CH) } : this.freeSpot(c));
      this.my.battlefield.push(c);
    }
    this.log(`${this.myName()} created ${n > 1 ? n + ' ' : 'a '}${gameCard.name} token${n > 1 ? 's' : ''}.`);
    this.sync();
  },
  _lifeAcc: 0, _lifeT: null, _lifeFrom: null,
  setLife(delta, silent) {
    if (!delta) return;
    if (this._lifeFrom == null) this._lifeFrom = this.my.life;
    this.my.life += delta; Sound.play('life');
    if (this.M.teams) Net.broadcast('teamlife', { life: this.my.life });
    this.sync();
    clearTimeout(this._lifeT);
    this._lifeT = setTimeout(() => {
      const from = this._lifeFrom, to = this.my.life, d = to - from; this._lifeFrom = null;
      if (d && !silent) { this.my.lifeHistory.push({ t: this.turn.n, from, to }); this.log(`${this.myName()}: life ${from} → ${to} (${d > 0 ? '+' : ''}${d}).`); }
    }, 1200);
  },
  setStat(key, delta) {
    this.my[key] = Math.max(0, (this.my[key] || 0) + delta);
    const label = { poison: 'poison', energy: 'energy', exp: 'experience', rad: 'rad' }[key];
    this.log(`${this.myName()} now has ${this.my[key]} ${label} counter${this.my[key] === 1 ? '' : 's'}.`);
    this.sync();
  },
  cmdDamage(key, delta, label) {
    const cur = Math.max(0, (this.my.cmdDmg[key] || 0) + delta);
    const real = cur - (this.my.cmdDmg[key] || 0);
    if (!real) return;
    this.my.cmdDmg[key] = cur;
    if (Settings.get('cmdDmgAffectsLife')) { this.my.life -= real; if (this.M.teams) Net.broadcast('teamlife', { life: this.my.life }); }
    this.log(`${this.myName()} has taken ${cur} commander damage from ${label}.`);
    if (cur >= this.settings.cmdLethal) toast(`Lethal commander damage from ${label}!`, 'err', 6000);
    this.sync();
  },
  roll(sides = 20) { const r = 1 + randInt(sides); this.log(`🎲 ${this.myName()} rolled a d${sides}: ${r}.`); Sound.play('shuffle'); return r; },
  flipCoin() { this.log(`🪙 ${this.myName()} flipped a coin: ${randInt(2) ? 'Heads' : 'Tails'}.`); },
  revealHand(on = !this.my.handRevealed) { this.my.handRevealed = on; this.log(`${this.myName()} ${on ? 'revealed' : 'hid'} their hand.`); this.sync(); },
  revealCards(cards, title) {
    Net.broadcast('reveal', { cards: cards.map(c => c.c), title: `${this.myName()} reveals${title ? ' — ' + title : ''}` });
    this.log(`${this.myName()} revealed ${cards.map(c => c.c.name).join(', ')}.`);
  },
  toggleTopReveal() { this.my.topRevealed = !this.my.topRevealed; this.log(`${this.myName()} is ${this.my.topRevealed ? 'now' : 'no longer'} playing with the top card revealed.`); this.sync(); },
  concede() { this.my.dead = true; this.log(`☠ ${this.myName()} conceded.`); this.sync(); if (this.isActive(this.me)) this.passTurn(); },

  /* ---------------- mulligans ---------------- */
  mulligan() {
    if (this.my.kept) return;
    this.pushUndo();
    const m = this.my, rule = this.settings.mulligan, size = +this.settings.hand || 7;
    m.library.push(...m.hand); m.hand = []; shuffle(m.library); m.mulligans++;
    const free = this.settings.freeMull && this.seating.length > 2 ? 1 : 0;
    const n = rule === 'london' ? size : Math.max(0, size - Math.max(0, m.mulligans - free));
    for (let i = 0; i < n; i++) if (m.library.length) m.hand.push(m.library.shift());
    this.log(`${this.myName()} mulliganed (${m.mulligans}).`);
    Sound.play('shuffle'); this.sync();
  },
  keep() {
    const m = this.my; m.kept = true;
    const free = this.settings.freeMull && this.seating.length > 2 ? 1 : 0;
    const bottom = this.settings.mulligan === 'london' ? Math.max(0, m.mulligans - free) : 0;
    this.log(`${this.myName()} kept ${m.hand.length - bottom} card${m.hand.length - bottom === 1 ? '' : 's'}.`);
    this.sync();
    if (bottom > 0) Board.chooseBottom(bottom);
    else if (this.settings.mulligan === 'vancouver' && m.mulligans > 0) toast('Vancouver rule: you may scry 1 (right-click your library → View top 1).', '', 7000);
  },

  /* ---------------- turns ---------------- */
  canAct() { return this.isActive(this.me) || !this.online; },
  nextPhase() {
    if (this.turn.phase >= PHASES.length - 1) return this.passTurn();
    this.setTurn({ ...this.turn, phase: this.turn.phase + 1 });
  },
  setPhase(i) { this.setTurn({ ...this.turn, phase: i }); },
  passTurn() {
    const alive = this.seating.filter(p => !(p === this.me ? this.my.dead : this.pub[p]?.dead));
    if (!alive.length) return;
    let i = this.seating.indexOf(this.turn.active), next = this.turn.active;
    for (let k = 0; k < this.seating.length; k++) {
      i = (i + 1) % this.seating.length; const cand = this.seating[i];
      if (alive.includes(cand) && (!this.M.teams || this.team(cand) !== this.team(this.turn.active))) { next = cand; break; }
    }
    if (this.settings.timer) { this.clocks[this.turn.active] = this.clockLeft(this.turn.active); }
    this.setTurn({ active: next, n: this.turn.n + 1, phase: 0, clocks: this.settings.timer ? this.clocks : undefined });
  },
  setTurn(t, remote) {
    const prev = this.turn;
    this.turn = { active: t.active, n: t.n, phase: t.phase };
    if (t.clocks) this.clocks = { ...t.clocks };
    if (prev.n !== t.n) this.clockStart = Date.now();
    if (!remote) Net.broadcast('turn', { turn: { ...this.turn, clocks: this.settings.timer ? this.clocks : undefined } });
    if (prev.n !== t.n) {
      this.log(`— Turn ${t.n}: ${this.M.teams ? 'Team of ' : ''}${this.name(t.active)} —`, 'game', true);
      Sound.play('turn');
      if (Settings.get('arrowsClearOnTurn')) { this.arrows = []; }
      if (this.isActive(this.me) && !this.my.dead) this.onMyTurnStart();
    } else if (prev.phase !== t.phase && !remote) {
      this.log(`${this.myName()} → ${PHASES[t.phase]}.`, 'game');
    }
    Board.renderTurn(); Board.updateAll();
  },
  onMyTurnStart() {
    if (Settings.get('autoUntap')) this.untapAll(true);
    const skipFirst = this.settings.skipDraw && this.turn.n === 1;
    if (Settings.get('autoDraw') && !skipFirst) this.draw(1);
    if (this.global.monarch === this.me) toast('You are the monarch — draw a card at your end step.');
    announce('Your turn');
  },
  clockLeft(pid) {
    const base = this.clocks[pid] ?? 0;
    return this.isActive(pid) && this.turn.active === pid ? base - (Date.now() - this.clockStart) : base;
  },

  setGlobal(patch) {
    Object.assign(this.global, patch);
    Net.broadcast('global', { global: this.global });
    Board.renderSide(); Board.updateAll();
  },

  /* ---------------- arrows ---------------- */
  addArrow(from, to) {
    const a = { id: uid(8), owner: this.me, from, to };
    this.arrows.push(a); Net.broadcast('arrow', { arrow: a }); Sound.play('arrow');
  },
  clearArrows(owner = this.me) {
    this.arrows = this.arrows.filter(a => owner !== '*' && a.owner !== owner);
    Net.broadcast('arrows-clear', { owner });
  },

  /* ---------------- sideboarding / restart ---------------- */
  sideboardModal() {
    const main = this.deckSrc.main, side = this.deckSrc.side;
    const render = () => {
      const col = (list, other, label) => {
        const counts = {}; list.forEach(c => (counts[c.name] ||= { c, n: 0 }).n++);
        return h('div', null, h('h3', null, `${label} (${list.length})`), h('div', { style: { maxHeight: '50vh', overflow: 'auto' } },
          Object.values(counts).sort((a, b) => a.c.name.localeCompare(b.c.name)).map(({ c, n }) => {
            const row = h('div.d-row', null, h('b', null, n), h('span.nm', null, c.name), h('span', { html: manaHTML(c.mana) }),
              h('button.btn.small', { onclick: () => { list.splice(list.findIndex(x => x.name === c.name), 1); other.push(c); render(); } }, label === 'Main' ? '→ Side' : '← Main'));
            Preview.bind(row, () => c); return row;
          })));
      };
      body.replaceChildren(h('div.grid2', null, col(main, side, 'Main'), col(side, main, 'Side')));
    };
    const body = h('div'); render();
    Modal.open({ title: 'Sideboarding', size: 'wide', body, foot: [h('button.btn.primary', { onclick: () => { Modal.close(); this.match.game++; this.newGame(); } }, 'Start next game with this list')] });
  },

  leave() {
    this.active = false; this.arrows = [];
    Lobby.leave(); Board.teardown(); App.show('home');
  },

  /* ---------------- network handlers ---------------- */
  initNet() {
    Net.on('pstate', m => {
      if (!this.active || !this.seating.includes(m.from)) return;
      const prevDead = this.pub[m.from]?.dead;
      this.pub[m.from] = m.state; Board.update(m.from); Board.renderSide();
      if (!prevDead && m.state.dead) Board.updateAll();
    });
    Net.on('log', m => { if (this.active) { this.log(String(m.text).slice(0, 500), m.kind === 'chat' ? 'chat' : 'game', true); if (m.kind === 'chat' && Settings.get('chatSound')) Sound.play('chat'); } });
    Net.on('turn', m => { if (this.active) this.setTurn(m.turn, true); });
    Net.on('global', m => { if (this.active) { this.global = m.global; Board.renderSide(); Board.updateAll(); } });
    Net.on('arrow', m => { if (this.active && m.arrow) { this.arrows.push({ ...m.arrow, owner: m.from }); Sound.play('arrow'); } });
    Net.on('arrows-clear', m => { this.arrows = this.arrows.filter(a => m.owner !== '*' && a.owner !== m.from); });
    Net.on('reveal', m => { if (this.active) Board.showReveal(m.title, m.cards || []); });
    Net.on('teamlife', m => { if (this.active && this.M.teams && this.team(m.from) === this.team(this.me) && m.from !== this.me) { this.my.life = m.life; this.sync(); } });
    Net.on('peer-left', m => { if (this.active && this.info[m.pid]) { this.pub[m.pid] = { ...(this.pub[m.pid] || {}), dc: true }; this.log(`${this.name(m.pid)} disconnected.`, 'game', true); Board.update(m.pid); } });
    Net.on('host-left', () => { if (this.active) { this.log('The host left — the table is now offline. You can keep playing solo or leave.', 'game', true); toast('Host disconnected', 'err', 8000); } });
    Net.on('bye', m => { if (this.active && this.info[m.from]) { this.log(`${this.name(m.from)} left the game.`, 'game', true); } });
    Net.on('match', m => { if (this.active) { this.match = m.match; Board.renderSide(); } });
  },
};
