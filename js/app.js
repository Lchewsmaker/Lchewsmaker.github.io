/* App bootstrap & navigation. */
'use strict';

const App = {
  view: 'home',
  show(view) {
    if (view === 'game' && !Game.active) view = 'home';
    this.view = view;
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
    $$('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.view === view)));
    Preview.hide(); Menu.closeAll();
    if (view === 'game') requestAnimationFrame(() => Board.fitAll());
    if (view === 'home') { Lobby.renderDeckSelect(); Lobby.renderHomeDecks(); }
  },
  onDecksChanged() {
    if (!this._ready) return;
    clearTimeout(this._dt);
    this._dt = setTimeout(() => { Lobby.renderDeckSelect(); Lobby.renderHomeDecks(); Lobby.pushMe(); }, 50);
  },
  refreshAll() { Lobby.renderDeckSelect(); Lobby.renderHomeDecks(); Lobby.renderColors(); Builder.renderDeckList(); Builder.open(Builder.deckId && Decks.get(Builder.deckId) ? Builder.deckId : Decks.all()[0]?.id); },

  async seedStarter() {
    // First visit: give new players something to play with.
    if (Decks.all().some(d => d.cards.length) || Store.get('seeded')) return;
    Store.set('seeded', true);
    const blank = Decks.all().filter(d => !d.cards.length && d.name === 'New deck').map(d => d.id);
    const list = `Commander\n1 Krenko, Mob Boss\n\nDeck\n1 Sol Ring\n1 Arcane Signet\n1 Mind Stone\n1 Goblin Matron\n1 Goblin Recruiter\n1 Skirk Prospector\n1 Goblin Chieftain\n1 Goblin King\n1 Goblin Warchief\n1 Goblin Instigator\n1 Beetleback Chief\n1 Siege-Gang Commander\n1 Legion Warboss\n1 Goblin Rabblemaster\n1 Conspicuous Snoop\n1 Mogg War Marshal\n1 Goblin Matron\n1 Lightning Bolt\n1 Chaos Warp\n1 Blasphemous Act\n1 Impact Tremors\n1 Purphoros, God of the Forge\n1 Shared Animosity\n1 Coat of Arms\n1 Skullclamp\n1 Thousand-Year Elixir\n1 Lightning Greaves\n1 Swiftfoot Boots\n1 Hordeling Outburst\n1 Krenko, Tin Street Kingpin\n1 Goblin Bombardment\n1 Faithless Looting\n1 Wheel of Fortune\n1 Reckless Charge\n30 Mountain\n1 Command Tower\n1 Castle Embereth\n1 Valakut, the Molten Pinnacle`;
    try {
      const entries = Decks.parseList(list);
      const seen = new Set(); const uniq = entries.filter(e => (e.board === 'main' && e.name !== 'Mountain') ? (seen.has(e.name) ? false : seen.add(e.name)) : true);
      const { resolved } = await Decks.resolveList(uniq);
      const d = Decks.create('Starter — Krenko Goblins', 'commander');
      const mtn = resolved.find(e => e.c.name === 'Mountain');
      if (mtn) mtn.qty = Math.max(1, mtn.qty + 100 - resolved.reduce((s, e) => s + e.qty, 0));
      d.cards = resolved; Decks.save(d);
      blank.forEach(id => Decks.remove(id));
      Builder.deckId = d.id;
      const p = Lobby.profile(); p.deckId = d.id; Lobby.saveProfile(p);
      this.refreshAll();
      toast('Added a starter Commander deck so you can jump right in', 'ok', 5000);
    } catch { /* offline: fine */ }
  },

  init() {
    Settings.load();
    Preview.init();
    initCollapsibles();
    $$('.tab').forEach(t => t.onclick = () => this.show(t.dataset.view));
    $('#btn-settings').onclick = () => Settings.openModal();
    $('#btn-shortcuts').onclick = () => Modal.open({ title: 'Keyboard shortcuts', id: 'shortcuts', body: Settings.shortcutsTable() });
    Builder.init();
    Lobby.init();
    Game.initNet();
    this._ready = true;
    this.show('home');
    Settings.onChange(k => { if (k === 'colorblind' || k === '*') { Lobby.renderColors(); Lobby.renderRoom(); } });
    window.addEventListener('beforeunload', e => { if (Game.active && Game.online) { e.preventDefault(); e.returnValue = ''; } });
    this.seedStarter();
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
