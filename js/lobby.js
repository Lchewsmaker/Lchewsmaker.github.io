/* Lobby: profile, game modes, room management, game start. */
'use strict';

const MODES = {
  duel: { name: '1v1 Constructed', short: '1v1', min: 1, max: 2, life: 20, hand: 7, commander: false, cmdDamage: false, skipDraw: true, freeMull: false, match: true, sideboard: true,
    desc: '20 life, 60-card decks. Best-of-three match tracking and sideboarding between games. Starting player skips their first draw.' },
  cmd4: { name: 'Commander', short: 'EDH', min: 1, max: 6, life: 40, hand: 7, commander: true, cmdDamage: true, skipDraw: false, freeMull: true, monarch: true,
    desc: '2–6 players (4 is classic), 40 life, command zone, commander tax, 21 commander damage, monarch / initiative, free first mulligan.' },
  cmd2: { name: 'Commander Duel', short: 'Duel EDH', min: 1, max: 2, life: 20, hand: 7, commander: true, cmdDamage: true, skipDraw: true, freeMull: false, match: true,
    desc: 'Head-to-head Commander: 20 life, command zone and tax, commander damage tracking.' },
  ffa: { name: 'Free-for-all', short: 'FFA', min: 1, max: 6, life: 20, hand: 7, commander: false, cmdDamage: false, skipDraw: false, freeMull: true, monarch: true,
    desc: '3–6 player multiplayer with 60-card decks, 20 life, monarch and initiative available.' },
  thg: { name: 'Two-Headed Giant', short: '2HG', min: 1, max: 4, life: 30, hand: 7, commander: false, cmdDamage: false, skipDraw: true, freeMull: true, teams: true,
    desc: 'Teams of two share 30 life and take turns together. Seats 1&3 vs 2&4.' },
  brawl: { name: 'Brawl', short: 'Brawl', min: 1, max: 2, life: 25, hand: 7, commander: true, cmdDamage: false, skipDraw: true, freeMull: true,
    desc: 'Standard-legal singleton with a commander, 25 life (1v1). No commander damage.' },
};
const MODE_DECK_FORMAT = { duel: null, cmd4: 'commander', cmd2: 'duel', ffa: null, thg: null, brawl: 'brawl' };

const Lobby = {
  state: null,      // shared lobby state (host authoritative)
  inRoom: false,
  ready: false,

  profile() {
    const p = Store.get('profile', null) || { name: 'Planeswalker ' + (100 + randInt(900)), color: PLAYER_COLORS[randInt(PLAYER_COLORS.length)].c, deckId: null };
    if (!p.deckId || !Decks.get(p.deckId)) p.deckId = Decks.all()[0]?.id || null;
    return p;
  },
  saveProfile(p) { Store.set('profile', p); },

  defaultState(mode = Store.get('lastMode', 'cmd4')) {
    const m = MODES[mode] || MODES.cmd4;
    return { mode, started: false, settings: { life: m.life, hand: m.hand, mulligan: 'london', first: 'random', cmdLethal: 21, poison: 10, freeMull: m.freeMull, skipDraw: m.skipDraw, shuffleSeats: true, timer: false, timerMin: 20, validate: false }, players: [] };
  },

  init() {
    this.state = this.defaultState();
    const p = this.profile(); this.saveProfile(p);
    $('#profile-name').value = p.name;
    $('#profile-name').onchange = e => { const p = this.profile(); p.name = e.target.value.trim().slice(0, 24) || p.name; this.saveProfile(p); this.pushMe(); };
    this.renderColors();
    this.renderDeckSelect();
    $('#profile-deck').onchange = e => { const p = this.profile(); p.deckId = e.target.value; this.saveProfile(p); this.renderHomeDecks(); this.setReady(false); this.pushMe(); };
    $('#btn-goto-builder').onclick = () => App.show('builder');
    $('#btn-host').onclick = () => this.host();
    $('#btn-join').onclick = () => this.join($('#join-code').value);
    $('#join-code').addEventListener('keydown', e => { if (e.key === 'Enter') this.join($('#join-code').value); });
    $('#btn-solo').onclick = () => this.startSolo(this.profile().deckId);
    $('#btn-leave').onclick = () => this.leave();
    $('#btn-copy-code').onclick = () => copyText(Net.code);
    $('#btn-copy-link').onclick = () => copyText(location.origin + location.pathname + '?join=' + Net.code);
    $('#btn-ready').onclick = () => this.setReady(!this.ready);
    $('#btn-start').onclick = () => this.hostStart();
    this.bindSettingsForm();
    this.renderModes();
    this.renderSettingsForm();
    this.renderHomeDecks();

    Net.on('hello', m => this.onHello(m));
    Net.on('player-update', m => { if (!Net.isHost) return; const pl = this.state.players.find(p => p.id === m.from); if (pl) { Object.assign(pl, this.sanitizePlayer(m.player)); this.hostBroadcast(); } });
    Net.on('lobby', m => { if (Net.isHost) return; this.state = m.state; this.renderRoom(); this.renderModes(); this.renderSettingsForm(); });
    Net.on('peer-left', m => {
      if (!Net.isHost) return;
      const pl = this.state.players.find(p => p.id === m.pid);
      if (!this.state.started) { this.state.players = this.state.players.filter(p => p.id !== m.pid); this.hostBroadcast(); }
      if (pl) toast(`${pl.name} left`);
    });
    Net.on('host-left', () => { if (!Game.active) { toast('The host closed the room', 'err'); this.leave(true); } });
    Net.on('kicked', () => { toast('You were removed from the room', 'err'); this.leave(true); });
    Net.on('start', m => { if (!Net.isHost) this.beginGame(m.state, m.seating, m.first, m.seed); });
    Net.on('rejected', m => { toast(m.reason, 'err', 6000); this.leave(true); });

    const join = new URLSearchParams(location.search).get('join');
    if (join) { $('#join-code').value = join; history.replaceState(null, '', location.pathname); setTimeout(() => this.join(join), 300); }
  },

  sanitizePlayer(p) {
    return { name: String(p.name || 'Player').slice(0, 24), color: /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : '#888888', ready: !!p.ready, deckName: String(p.deckName || '').slice(0, 60), deckCount: +p.deckCount || 0 };
  },
  myInfo() {
    const p = this.profile(), d = Decks.get(p.deckId);
    return { name: p.name, color: p.color, ready: this.ready, deckName: d?.name || '(no deck)', deckCount: d ? Decks.count(d, 'main') + Decks.count(d, 'commander') : 0 };
  },
  pushMe() {
    if (!this.inRoom) return;
    if (Net.isHost) { const me = this.state.players.find(p => p.id === Net.myId); if (me) Object.assign(me, this.myInfo()); this.hostBroadcast(); }
    else Net.broadcast('player-update', { player: this.myInfo() });
  },

  renderColors() {
    const p = this.profile();
    $('#profile-colors').replaceChildren(...PLAYER_COLORS.map((pc, i) => {
      const b = h('button.swatch', { role: 'radio', 'aria-checked': String(pc.c === p.color), 'aria-label': pc.n, title: pc.n, style: { background: Settings.playerColor(pc.c, i) } });
      b.onclick = () => { const p = this.profile(); p.color = pc.c; this.saveProfile(p); this.renderColors(); this.pushMe(); };
      return b;
    }));
  },
  renderDeckSelect() {
    const p = this.profile(), sel = $('#profile-deck');
    sel.replaceChildren(...Decks.all().map(d => h('option', { value: d.id, selected: d.id === p.deckId }, `${d.name} (${Decks.count(d, 'main') + Decks.count(d, 'commander')})`)));
    if (!Decks.all().length) sel.append(h('option', { value: '' }, 'No decks yet — build one!'));
  },
  renderHomeDecks() {
    const p = this.profile();
    const tiles = Decks.all().map(d => {
      const t = h('button.deck-tile' + (d.id === p.deckId ? '.selected' : ''), { title: 'Use this deck (double-click to edit)' },
        h('div.art', { style: { backgroundImage: Decks.cover(d) ? `url("${Decks.cover(d)}")` : '' } }),
        h('div.meta', null, h('b', null, d.name), h('span.muted.small', null, `${FORMATS[d.format]?.name || d.format} · ${Decks.count(d, 'main') + Decks.count(d, 'commander')} cards`)));
      t.onclick = () => { const p = this.profile(); p.deckId = d.id; this.saveProfile(p); this.renderDeckSelect(); this.renderHomeDecks(); this.setReady(false); this.pushMe(); };
      t.ondblclick = () => { Builder.open(d.id); App.show('builder'); };
      t.oncontextmenu = e => { e.preventDefault(); Menu.show(e.clientX, e.clientY, [
        { label: 'Use this deck', action: () => t.click() }, { label: 'Edit', action: () => { Builder.open(d.id); App.show('builder'); } },
        { label: 'Playtest solo', action: () => this.startSolo(d.id) }], d.name); };
      return t;
    });
    tiles.push(h('button.deck-tile', { onclick: () => { Builder.open(Decks.create().id); App.show('builder'); } }, h('div.art', { style: { display: 'grid', placeItems: 'center', fontSize: '2rem' } }, '+'), h('div.meta', null, h('b', null, 'New deck'), h('span.muted.small', null, 'Open the builder'))));
    $('#home-decks').replaceChildren(...tiles);
  },

  /* ---------------- modes & settings ---------------- */
  canEdit() { return !this.inRoom || Net.isHost; },
  renderModes() {
    const cur = this.state.mode;
    $('#mode-picker').replaceChildren(...Object.entries(MODES).map(([k, m]) => {
      const b = h('button.mode-opt', { role: 'radio', 'aria-checked': String(k === cur), disabled: !this.canEdit() && k !== cur }, h('b', null, m.name), h('small', null, m.max === 2 ? '2 players' : m.teams ? '4 players · teams' : `up to ${m.max} players`));
      b.onclick = () => { if (!this.canEdit()) return; this.setMode(k); };
      return b;
    }));
    $('#mode-desc').textContent = MODES[cur].desc;
    $('#gs-host-note').hidden = this.canEdit();
  },
  setMode(k) {
    const m = MODES[k]; Store.set('lastMode', k);
    this.state.mode = k;
    Object.assign(this.state.settings, { life: m.life, hand: m.hand, freeMull: m.freeMull, skipDraw: m.skipDraw });
    this.renderModes(); this.renderSettingsForm(); this.hostBroadcast(); this.renderRoom();
  },
  bindSettingsForm() {
    const map = { 'gs-life': 'life', 'gs-hand': 'hand', 'gs-mulligan': 'mulligan', 'gs-first': 'first', 'gs-cmdlethal': 'cmdLethal', 'gs-poison': 'poison', 'gs-freemull': 'freeMull', 'gs-skipdraw': 'skipDraw', 'gs-shuffle-seats': 'shuffleSeats', 'gs-turn-timer': 'timer', 'gs-timer-min': 'timerMin', 'gs-validate': 'validate' };
    for (const [id, key] of Object.entries(map)) {
      $('#' + id).addEventListener('change', e => {
        const el = e.target; this.state.settings[key] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? clamp(+el.value || 0, +el.min || 0, +el.max || 999) : el.value;
        this.hostBroadcast();
      });
    }
  },
  renderSettingsForm() {
    const s = this.state.settings, dis = !this.canEdit();
    const set = (id, v) => { const el = $('#' + id); if (el.type === 'checkbox') el.checked = v; else el.value = v; el.disabled = dis; };
    set('gs-life', s.life); set('gs-hand', s.hand); set('gs-mulligan', s.mulligan); set('gs-first', s.first); set('gs-cmdlethal', s.cmdLethal); set('gs-poison', s.poison);
    set('gs-freemull', s.freeMull); set('gs-skipdraw', s.skipDraw); set('gs-shuffle-seats', s.shuffleSeats); set('gs-turn-timer', s.timer); set('gs-timer-min', s.timerMin); set('gs-validate', s.validate);
    $('#gs-cmdlethal').closest('.field').hidden = !MODES[this.state.mode].cmdDamage;
  },

  /* ---------------- rooms ---------------- */
  async host() {
    if (!this.profile().deckId) { toast('Build or import a deck first', 'err'); App.show('builder'); return; }
    try {
      $('#btn-host').disabled = true;
      await Net.host();
      this.inRoom = true; this.ready = true;
      const mode = this.state.mode, settings = this.state.settings;
      this.state = { mode, settings, started: false, players: [{ id: Net.myId, host: true, ...this.myInfo() }] };
      this.renderRoom(); this.renderModes(); this.renderSettingsForm();
      toast('Room created — share the code with friends', 'ok');
    } catch (e) { toast('Could not host: ' + (e.message || e.type), 'err', 6000); }
    finally { $('#btn-host').disabled = false; }
  },
  async join(code) {
    code = (code || '').trim().toUpperCase();
    if (code.length < 4) { toast('Enter the room code', 'err'); return; }
    if (!this.profile().deckId) { toast('Build or import a deck first', 'err'); App.show('builder'); return; }
    try {
      $('#btn-join').disabled = true;
      await Net.join(code);
      this.inRoom = true; this.ready = false;
      Net.broadcast('hello', { player: this.myInfo() });
      this.renderRoom();
    } catch (e) { toast(e.message || 'Could not join', 'err', 6000); }
    finally { $('#btn-join').disabled = false; }
  },
  onHello(m) {
    if (!Net.isHost) return;
    if (this.state.started) { Net.sendTo(m.from, 'rejected', { reason: 'That game has already started.' }); return; }
    const max = MODES[this.state.mode].max;
    if (this.state.players.length >= max) { Net.sendTo(m.from, 'rejected', { reason: `Room is full (${max} players for ${MODES[this.state.mode].name}).` }); return; }
    if (!this.state.players.find(p => p.id === m.from)) this.state.players.push({ id: m.from, ...this.sanitizePlayer(m.player) });
    Sound.play('join'); toast(`${m.player?.name || 'A player'} joined`);
    this.hostBroadcast();
  },
  hostBroadcast() {
    if (!this.inRoom || !Net.isHost) return;
    Net.broadcast('lobby', { state: this.state });
    this.renderRoom();
  },
  setReady(r) {
    if (r && this.state.settings.validate) {
      const fk = MODE_DECK_FORMAT[this.state.mode] || Decks.get(this.profile().deckId)?.format;
      const d = Decks.get(this.profile().deckId);
      if (d && fk) { const v = Decks.validate(d, fk); if (!v.ok) { Modal.open({ title: 'Deck not legal', size: 'narrow', body: h('ul', null, v.problems.map(p => h('li', null, p))) }); return; } }
    }
    this.ready = r; this.pushMe(); this.renderRoom();
  },
  leave(silent) {
    Net.leave(silent); this.inRoom = false; this.ready = false;
    const { mode, settings } = this.state; this.state = { ...this.defaultState(mode), settings };
    this.renderRoom(); this.renderModes(); this.renderSettingsForm();
  },

  renderRoom() {
    $('#room-idle').hidden = this.inRoom; $('#room-active').hidden = !this.inRoom;
    if (!this.inRoom) return;
    $('#room-code').textContent = Net.code;
    const max = MODES[this.state.mode].max;
    $('#player-count').textContent = `${this.state.players.length}/${max}`;
    $('#lobby-players').replaceChildren(...this.state.players.map((p, i) => {
      const li = h('li', null, h('span.dot', { style: { background: Settings.playerColor(p.color, i), '--pat': Settings.playerPattern(p.color) } }),
        h('b', null, p.name), p.host ? h('span.host-tag', null, 'HOST') : null,
        MODES[this.state.mode].teams ? h('span.badge', null, 'Team ' + (i % 2 ? 'B' : 'A')) : null,
        h('span.pdeck', null, `${p.deckName} · ${p.deckCount}`),
        h('span', { class: p.ready || p.host ? 'ready' : 'notready' }, p.host ? 'HOST' : p.ready ? 'READY' : 'not ready'));
      if (Net.isHost && p.id !== Net.myId) li.oncontextmenu = e => { e.preventDefault(); Menu.show(e.clientX, e.clientY, [
        { label: 'Move up', action: () => { if (i > 0) { [this.state.players[i - 1], this.state.players[i]] = [this.state.players[i], this.state.players[i - 1]]; this.hostBroadcast(); } } },
        { label: 'Kick', action: () => { Net.sendTo(p.id, 'kicked'); this.state.players.splice(i, 1); this.hostBroadcast(); } }], p.name); };
      return li;
    }));
    $('#btn-ready').hidden = Net.isHost;
    $('#btn-ready').textContent = this.ready ? 'Not ready' : 'Ready';
    $('#btn-ready').classList.toggle('primary', !this.ready);
    $('#btn-start').hidden = !Net.isHost;
    const allReady = this.state.players.every(p => p.host || p.ready);
    $('#btn-start').disabled = !allReady;
    $('#btn-start').title = allReady ? '' : 'Waiting for everyone to be ready';
  },

  hostStart() {
    const st = this.state;
    let seating = st.players.map(p => p.id);
    if (st.settings.shuffleSeats && !MODES[st.mode].teams) shuffle(seating);
    let first = seating[0];
    if (st.settings.first === 'random' || st.settings.first === 'choose') first = seating[randInt(seating.length)];
    st.started = true;
    // give everyone a distinct colour so boards and arrows are distinguishable
    const used = new Set();
    for (const p of st.players) {
      if (used.has(p.color)) p.color = (PLAYER_COLORS.find(c => !used.has(c.c)) || PLAYER_COLORS[0]).c;
      used.add(p.color);
    }
    const seed = uid(6);
    Net.broadcast('start', { state: st, seating, first, seed });
    this.beginGame(st, seating, first, seed);
  },

  beginGame(state, seating, first, seed) {
    this.state = state;
    const deck = Decks.get(this.profile().deckId);
    if (!deck) { toast('Pick a deck first', 'err'); return; }
    Game.start({ mode: state.mode, settings: state.settings, players: state.players, seating, first, me: Net.myId, deck, online: true });
  },

  startSolo(deckId) {
    const deck = Decks.get(deckId);
    if (!deck || !deck.cards.length) { toast('Pick a deck with cards in it first', 'err'); return; }
    const me = { id: 'me', ...this.myInfo() };
    const mode = this.state.mode;
    Game.start({ mode, settings: this.state.settings, players: [me], seating: ['me'], first: 'me', me: 'me', deck, online: false });
  },
};
