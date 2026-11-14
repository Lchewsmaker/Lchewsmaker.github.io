/* User settings: schema-driven, persisted locally, applied as classes / CSS variables. */
'use strict';

const PLAYER_COLORS = [
  { c: '#e45858', n: 'Red' }, { c: '#5aa7ff', n: 'Blue' }, { c: '#4cc38a', n: 'Green' }, { c: '#e2b04a', n: 'Gold' },
  { c: '#b07cf0', n: 'Purple' }, { c: '#f08ac0', n: 'Pink' }, { c: '#40c9c9', n: 'Teal' }, { c: '#f08a3c', n: 'Orange' },
];
// Okabe–Ito palette (colour-blind safe) used when that option is on
const CB_COLORS = ['#D55E00', '#0072B2', '#009E73', '#E69F00', '#CC79A7', '#56B4E9', '#F0E442', '#999999'];
const CB_PATTERNS = [
  'none',
  'repeating-linear-gradient(45deg,#0008 0 2px,transparent 2px 6px)',
  'repeating-linear-gradient(-45deg,#0008 0 2px,transparent 2px 6px)',
  'radial-gradient(#0009 1.5px,transparent 1.6px)',
  'repeating-linear-gradient(0deg,#0008 0 2px,transparent 2px 6px)',
  'repeating-linear-gradient(90deg,#0008 0 2px,transparent 2px 6px)',
  'linear-gradient(45deg,#0008 25%,transparent 25% 75%,#0008 75%)',
  'conic-gradient(#0008 25%,transparent 0 50%,#0008 0 75%,transparent 0)',
];

const FELTS = {
  emerald: ['#1e3a33', '#17302a'], navy: ['#1d2a44', '#141e33'], crimson: ['#3d1c22', '#2c1418'],
  slate: ['#2a2e36', '#1f2228'], violet: ['#2d2242', '#211833'], sand: ['#4a3f2c', '#3a3122'], black: ['#141414', '#0b0b0b'],
};

const SETTINGS_SCHEMA = [
  { sec: 'Display', items: [
    { key: 'boardView', label: 'Board view', help: 'How opponents’ battlefields are arranged', type: 'select', options: [['focus', 'Focus — you large, opponents above'], ['grid', 'Grid — every board the same size'], ['spotlight', 'Spotlight — you + one opponent, tabs to switch']] },
    { key: 'mirrorOpps', label: 'Face-to-face opponents', help: 'Rotate opponent boards 180° like sitting across a real table', type: 'toggle' },
    { key: 'cardScale', label: 'Battlefield card size', type: 'range', min: .7, max: 1.4, step: .05, fmt: v => Math.round(v * 100) + '%' },
    { key: 'handSize', label: 'Hand card height', type: 'range', min: 90, max: 240, step: 5, fmt: v => v + 'px' },
    { key: 'handSpread', label: 'Spread hand (no overlap)', type: 'toggle' },
    { key: 'showNames', label: 'Show card names on battlefield', type: 'toggle' },
    { key: 'preview', label: 'Card preview', type: 'select', options: [['hover', 'On hover'], ['alt', 'Hold Alt / Z'], ['off', 'Off']] },
    { key: 'previewPos', label: 'Preview position', type: 'select', options: [['cursor', 'Next to cursor'], ['right', 'Fixed right'], ['left', 'Fixed left']] },
    { key: 'previewSize', label: 'Preview size', type: 'range', min: 200, max: 480, step: 10, fmt: v => v + 'px' },
    { key: 'previewText', label: 'Show Oracle text under preview', type: 'toggle' },
    { key: 'felt', label: 'Playmat colour', type: 'select', options: Object.keys(FELTS).map(k => [k, k[0].toUpperCase() + k.slice(1)]) },
    { key: 'playmatUrl', label: 'Custom playmat image URL', help: 'Applied to your board only, on your screen', type: 'text' },
    { key: 'lightUi', label: 'Light interface', help: 'Menus and panels in light colours (table stays felt)', type: 'toggle' },
  ] },
  { sec: 'Gameplay', items: [
    { key: 'autoUntap', label: 'Auto-untap at start of my turn', type: 'toggle' },
    { key: 'autoDraw', label: 'Auto-draw at start of my turn', type: 'toggle' },
    { key: 'dblClickTap', label: 'Double-click to tap / untap', type: 'toggle' },
    { key: 'clickLibDraw', label: 'Click library to draw', type: 'toggle' },
    { key: 'snapGrid', label: 'Snap cards to grid', type: 'toggle' },
    { key: 'confirmDanger', label: 'Confirm before concede / reset / shuffle graveyard', type: 'toggle' },
    { key: 'arrowsClearOnTurn', label: 'Clear arrows when the turn passes', type: 'toggle' },
    { key: 'arrowWidth', label: 'Arrow thickness', type: 'range', min: 3, max: 14, step: 1, fmt: v => v + 'px' },
    { key: 'cmdToZonePrompt', label: 'Offer to return commander to command zone', type: 'toggle' },
    { key: 'cmdDmgAffectsLife', label: 'Commander damage also reduces life', type: 'toggle' },
    { key: 'logTimestamps', label: 'Timestamps in log', type: 'toggle' },
  ] },
  { sec: 'Accessibility', items: [
    { key: 'uiScale', label: 'Interface scale', type: 'range', min: .8, max: 1.6, step: .05, fmt: v => Math.round(v * 100) + '%' },
    { key: 'highContrast', label: 'High contrast', type: 'toggle' },
    { key: 'legibleFont', label: 'Hyper-legible font', help: 'Atkinson Hyperlegible, designed for low-vision readers', type: 'toggle' },
    { key: 'bigText', label: 'Larger text', type: 'toggle' },
    { key: 'reduceMotion', label: 'Reduce motion', type: 'toggle' },
    { key: 'colorblind', label: 'Colour-blind safe player colours', help: 'Okabe–Ito palette plus patterns on player markers', type: 'toggle' },
    { key: 'arrowColor', label: 'Arrow colour', help: 'Red by default; change if red is hard to see', type: 'color' },
    { key: 'srAnnounce', label: 'Screen-reader announcements', help: 'Read game log events aloud via a live region', type: 'toggle' },
    { key: 'keyboardCards', label: 'Keyboard card focus', help: 'Tab through cards; Enter / Shift+F10 opens the card menu', type: 'toggle' },
    { key: 'longPressMenu', label: 'Long-press opens menu (touch)', type: 'toggle' },
  ] },
  { sec: 'Audio', items: [
    { key: 'sound', label: 'Sound effects', type: 'toggle' },
    { key: 'volume', label: 'Volume', type: 'range', min: 0, max: 1, step: .05, fmt: v => Math.round(v * 100) + '%' },
    { key: 'chatSound', label: 'Sound on chat message', type: 'toggle' },
  ] },
];

const SETTINGS_DEFAULTS = {
  boardView: 'focus', mirrorOpps: false, cardScale: 1, handSize: 150, handSpread: false, showNames: false,
  preview: 'hover', previewPos: 'cursor', previewSize: 300, previewText: false, felt: 'emerald', playmatUrl: '', lightUi: false,
  autoUntap: true, autoDraw: true, dblClickTap: true, clickLibDraw: true, snapGrid: false, confirmDanger: true,
  arrowsClearOnTurn: true, arrowWidth: 7, cmdToZonePrompt: true, cmdDmgAffectsLife: true, logTimestamps: false,
  uiScale: 1, highContrast: false, legibleFont: false, bigText: false, reduceMotion: false, colorblind: false,
  arrowColor: '#ff2a2a', srAnnounce: false, keyboardCards: false, longPressMenu: true,
  sound: true, volume: .6, chatSound: true,
};

const SHORTCUTS = [
  ['W (hold / tap)', 'Draw a red arrow from the cursor to wherever you release — everyone sees it'],
  ['Shift + W', 'Clear your arrows'], ['D', 'Draw a card'], ['Shift + D', 'Draw X cards'],
  ['T / double-click', 'Tap / untap hovered card'], ['U', 'Untap all your permanents'], ['F', 'Flip / transform hovered card'],
  ['Shift + F', 'Turn hovered card face down / up'], ['C / Shift + C', 'Add / remove +1/+1 counter on hovered card'],
  ['G', 'Hovered card → graveyard'], ['X', 'Hovered card → exile'], ['H', 'Hovered card → hand'], ['B', 'Hovered card → bottom of library'],
  ['K', 'Clone hovered card (token copy)'], ['S', 'Shuffle library'], ['M', 'Mill 1'], ['N', 'Next phase'], ['E', 'Pass turn'],
  ['+ / −', 'Gain / lose 1 life'], ['Ctrl + Z', 'Undo your last action'], ['Z / Alt (hold)', 'Zoom hovered card'],
  ['Ctrl/Shift + click', 'Select multiple cards (drag moves the group)'], ['Esc', 'Close menus / cancel arrow / clear selection'],
  ['?', 'This list'], ['Right-click', 'Context menu for whatever is under the cursor'],
];

const Settings = {
  values: {},
  listeners: [],
  load() {
    this.values = { ...SETTINGS_DEFAULTS, ...Store.get('settings', {}) };
    this.apply();
  },
  get(k) { return this.values[k]; },
  set(k, v) {
    this.values[k] = v; Store.set('settings', this.values); this.apply();
    this.listeners.forEach(fn => fn(k, v));
  },
  onChange(fn) { this.listeners.push(fn); },
  playerColor(c, idx) {
    if (!this.values.colorblind) return c;
    const i = PLAYER_COLORS.findIndex(p => p.c === c);
    return CB_COLORS[(i >= 0 ? i : idx) % CB_COLORS.length];
  },
  playerPattern(c) {
    const i = PLAYER_COLORS.findIndex(p => p.c === c);
    return CB_PATTERNS[Math.max(0, i) % CB_PATTERNS.length];
  },
  apply() {
    const v = this.values, root = document.documentElement;
    root.style.setProperty('--ui-scale', v.uiScale);
    root.style.setProperty('--hand-h', v.handSize + 'px');
    root.style.setProperty('--hand-overlap', Math.round(v.handSize * .12) + 'px');
    root.style.setProperty('--preview-w', v.previewSize + 'px');
    root.style.setProperty('--arrow', v.arrowColor);
    const felt = FELTS[v.felt] || FELTS.emerald;
    root.style.setProperty('--felt', felt[0]); root.style.setProperty('--felt-2', felt[1]);
    root.classList.toggle('hc', v.highContrast);
    root.classList.toggle('legible', v.legibleFont);
    root.classList.toggle('big-text', v.bigText);
    root.classList.toggle('reduce-motion', v.reduceMotion);
    root.classList.toggle('show-names', v.showNames);
    root.classList.toggle('preview-text', v.previewText);
    root.classList.toggle('cb-patterns', v.colorblind);
    root.classList.toggle('light-ui', v.lightUi && !v.highContrast);
    $('#hand')?.classList.toggle('spread', v.handSpread);
  },

  openModal(startSec = 'Display') {
    const nav = h('nav.settings-nav', { 'aria-label': 'Settings sections' });
    const content = h('div.set-content');
    const secs = [...SETTINGS_SCHEMA.map(s => s.sec), 'Shortcuts', 'Data'];
    const show = name => {
      $$('button', nav).forEach(b => b.classList.toggle('on', b.textContent === name));
      content.replaceChildren(this._renderSec(name));
    };
    secs.forEach(s => nav.append(h('button', { onclick: () => show(s) }, s)));
    Modal.open({ title: 'Settings', size: 'wide', id: 'settings', body: h('div.settings-layout', null, nav, content),
      foot: [h('button.btn.ghost', { onclick: async () => { if (await Modal.confirm('Reset settings', 'Restore all settings to their defaults?', 'Reset', true)) { this.values = { ...SETTINGS_DEFAULTS }; Store.set('settings', this.values); this.apply(); this.listeners.forEach(fn => fn('*')); show(startSec); } } }, 'Reset to defaults'),
        h('button.btn.primary', { onclick: () => Modal.close() }, 'Done')] });
    show(startSec);
  },

  _renderSec(name) {
    if (name === 'Shortcuts') return this.shortcutsTable();
    if (name === 'Data') return this._dataSec();
    const sec = SETTINGS_SCHEMA.find(s => s.sec === name);
    const wrap = h('div.set-sec', null, h('h3', null, name));
    for (const it of sec.items) {
      const id = 'set-' + it.key;
      let ctrl;
      const val = this.get(it.key);
      if (it.type === 'toggle') {
        ctrl = h('input', { type: 'checkbox', id, role: 'switch', checked: val });
        ctrl.onchange = () => this.set(it.key, ctrl.checked);
      } else if (it.type === 'range') {
        const out = h('span.val', null, it.fmt ? it.fmt(val) : val);
        const r = h('input', { type: 'range', id, min: it.min, max: it.max, step: it.step, value: val });
        r.oninput = () => { out.textContent = it.fmt ? it.fmt(+r.value) : r.value; this.set(it.key, +r.value); };
        ctrl = h('div.row.gap', null, r, out);
      } else if (it.type === 'select') {
        ctrl = h('select', { id }, it.options.map(([v, l]) => h('option', { value: v, selected: v === val }, l)));
        ctrl.onchange = () => this.set(it.key, ctrl.value);
      } else if (it.type === 'color') {
        ctrl = h('input', { type: 'color', id, value: val });
        ctrl.oninput = () => this.set(it.key, ctrl.value);
      } else {
        ctrl = h('input', { id, value: val, placeholder: 'https://…', style: { width: '220px' } });
        ctrl.onchange = () => this.set(it.key, ctrl.value.trim());
      }
      wrap.append(h('div.set-row', null, h('label', { for: id }, it.label, it.help ? h('small', null, it.help) : null), ctrl));
    }
    return wrap;
  },

  shortcutsTable() {
    return h('div.set-sec', null, h('h3', null, 'Keyboard & mouse'),
      h('table.shortcut-table', null, h('tbody', null, SHORTCUTS.map(([k, d]) => h('tr', null, h('td', null, h('kbd', null, k)), h('td', null, d))))));
  },

  _dataSec() {
    return h('div.set-sec', null, h('h3', null, 'Your data'),
      h('p.muted', null, 'Decks and settings are saved in this browser only. Back them up or move them to another device here.'),
      h('div.row.gap.wrap', null,
        h('button.btn', { onclick: () => downloadText('void-tabletop-backup.json', JSON.stringify({ decks: Decks.all(), settings: this.values, profile: Store.get('profile') }, null, 1)) }, 'Download backup'),
        h('button.btn', { onclick: () => {
          const inp = h('input', { type: 'file', accept: '.json,application/json' });
          inp.onchange = async () => {
            try {
              const data = JSON.parse(await inp.files[0].text());
              if (Array.isArray(data.decks)) { data.decks.forEach(d => Decks.save(d)); }
              if (data.settings) { this.values = { ...SETTINGS_DEFAULTS, ...data.settings }; Store.set('settings', this.values); this.apply(); }
              if (data.profile) Store.set('profile', data.profile);
              toast('Backup restored', 'ok'); App.refreshAll();
            } catch (e) { toast('That file is not a valid backup', 'err'); }
          };
          inp.click();
        } }, 'Restore backup')),
      h('p.muted.small', { style: { marginTop: '1.5rem' } }, 'Card data and images are provided by Scryfall. Void Tabletop is unofficial Fan Content permitted under the Wizards of the Coast Fan Content Policy and is not approved or endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.'));
  },
};
