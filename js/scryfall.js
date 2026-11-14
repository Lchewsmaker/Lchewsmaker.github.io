/* Scryfall API client — all card data & images come from api.scryfall.com.
   Requests are queued ~110ms apart per Scryfall's rate-limit guidance and cached in memory. */
'use strict';

const Scry = {
  API: 'https://api.scryfall.com',
  cache: new Map(),
  _last: 0,
  _chain: Promise.resolve(),

  _throttle() {
    const p = this._chain.then(async () => {
      const wait = this._last + 110 - Date.now();
      if (wait > 0) await sleep(wait);
      this._last = Date.now();
    });
    this._chain = p.catch(() => {});
    return p;
  },

  async get(url, { cache = true } = {}) {
    if (!url.startsWith('http')) url = this.API + url;
    if (cache && this.cache.has(url)) return this.cache.get(url);
    await this._throttle();
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      if (res.status === 404 && data?.object === 'error') return { object: 'list', data: [], total_cards: 0, has_more: false, notFound: true, details: data.details };
      if (res.status === 429) { toast('Scryfall is rate-limiting us — slowing down', 'err'); await sleep(1000); return this.get(url, { cache }); }
      throw new Error(data?.details || `Scryfall error ${res.status}`);
    }
    if (cache) this.cache.set(url, data);
    return data;
  },

  async post(path, body) {
    await this._throttle();
    const res = await fetch(this.API + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.details || `Scryfall error ${res.status}`);
    return data;
  },

  search(q, { order = 'name', dir = 'auto', unique = 'cards', includeExtras = false } = {}) {
    const p = new URLSearchParams({ q, order, dir, unique });
    if (includeExtras) p.set('include_extras', 'true');
    return this.get('/cards/search?' + p);
  },
  async autocomplete(q) {
    if (q.length < 2) return [];
    const r = await this.get('/cards/autocomplete?q=' + encodeURIComponent(q));
    return r?.data || [];
  },
  named(name) { return this.get('/cards/named?fuzzy=' + encodeURIComponent(name)); },
  byId(id) { return this.get('/cards/' + id); },

  /** Resolve up to any number of identifiers via /cards/collection (75 per request). */
  async collection(identifiers, onProgress) {
    const found = [], notFound = [];
    for (let i = 0; i < identifiers.length; i += 75) {
      const chunk = identifiers.slice(i, i + 75);
      const r = await this.post('/cards/collection', { identifiers: chunk });
      found.push(...r.data); notFound.push(...(r.not_found || []));
      onProgress?.(Math.min(i + 75, identifiers.length), identifiers.length);
    }
    return { found, notFound };
  },

  /** All printings of a card (every page), newest first. */
  async prints(card) {
    const q = card.oid ? `oracleid:${card.oid}` : `!"${card.name}"`;
    let r = await this.search(q, { unique: 'prints', order: 'released', dir: 'desc', includeExtras: true });
    const out = [...(r.data || [])];
    while (r.has_more && out.length < 700) { r = await this.get(r.next_page); out.push(...r.data); }
    return out;
  },

  /** Normalise a Scryfall card object into the compact shape we store/sync. */
  slim(c) {
    const faces = c.card_faces || [];
    const img = (o, size) => o?.image_uris?.[size];
    const front = img(c, 'normal') || img(faces[0], 'normal') || '';
    const frontL = img(c, 'large') || img(faces[0], 'large') || front;
    const twoSided = !c.image_uris && faces.length > 1 && faces[1].image_uris;
    const legal = {};
    for (const [k, v] of Object.entries(c.legalities || {})) if (v !== 'not_legal') legal[k] = v;
    return {
      id: c.id, oid: c.oracle_id || faces[0]?.oracle_id, name: c.name, set: c.set, setName: c.set_name, cn: c.collector_number,
      img: front, imgL: frontL, art: img(c, 'art_crop') || img(faces[0], 'art_crop') || '',
      back: twoSided ? img(faces[1], 'normal') : '', backL: twoSided ? img(faces[1], 'large') : '',
      mana: c.mana_cost ?? faces.map(f => f.mana_cost).filter(Boolean).join(' // '),
      cmc: c.cmc ?? 0,
      type: c.type_line || faces.map(f => f.type_line).join(' // '),
      text: c.oracle_text ?? faces.map(f => `${f.name}\n${f.oracle_text || ''}`).join('\n—\n'),
      pt: c.power != null ? `${c.power}/${c.toughness}` : (faces[0]?.power != null ? `${faces[0].power}/${faces[0].toughness}` : ''),
      ptBack: faces[1]?.power != null ? `${faces[1].power}/${faces[1].toughness}` : '',
      loy: c.loyalty ?? faces[0]?.loyalty ?? '',
      colors: c.colors || faces[0]?.colors || [], ci: c.color_identity || [],
      layout: c.layout, rarity: c.rarity, usd: c.prices?.usd || c.prices?.usd_foil || null,
      released: c.released_at, legal, uri: c.scryfall_uri,
      faceNames: faces.length ? faces.map(f => f.name) : null,
      edhrec: c.edhrec_rank ?? null,
    };
  },

  /** Strip deck-only fields for in-game/network use. */
  gameCard(s) {
    const { legal, usd, released, setName, edhrec, art, ...rest } = s;
    return rest;
  },
};

/* A generated card back (SVG data URI) so we never depend on unofficial back images. */
const CARD_BACK = 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 488 680">
<defs><radialGradient id="g" cx="50%" cy="50%" r="65%"><stop offset="0" stop-color="#6b4a2a"/><stop offset=".55" stop-color="#3b2614"/><stop offset="1" stop-color="#1a0f07"/></radialGradient>
<radialGradient id="o" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#f6d27a"/><stop offset=".6" stop-color="#b9802c"/><stop offset="1" stop-color="#5c3a12"/></radialGradient></defs>
<rect width="488" height="680" rx="22" fill="#111"/><rect x="18" y="18" width="452" height="644" rx="16" fill="url(#g)"/>
<ellipse cx="244" cy="340" rx="150" ry="215" fill="none" stroke="#c99a4a" stroke-width="6" opacity=".8"/>
<ellipse cx="244" cy="340" rx="118" ry="180" fill="url(#o)" opacity=".9"/>
<path d="M244 205 L292 340 L244 475 L196 340 Z" fill="#2a180a" opacity=".85"/>
<circle cx="244" cy="340" r="26" fill="#f6d27a"/></svg>`);
