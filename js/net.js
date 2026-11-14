/* Peer-to-peer networking (PeerJS / WebRTC). Star topology: the host relays every message.
   No server of our own is needed, so this works on GitHub Pages. */
'use strict';

const Net = {
  PREFIX: 'voidtt-v2-',
  peer: null, isHost: false, hostConn: null, conns: new Map(), myId: 'me', code: null,
  handlers: {},
  online: false,

  on(type, fn) { (this.handlers[type] ||= []).push(fn); },
  emit(type, msg) { (this.handlers[type] || []).forEach(fn => { try { fn(msg); } catch (e) { console.error(e); } }); },

  setStatus(text, cls = '') { const el = $('#net-status'); el.textContent = text; el.className = 'net-status ' + cls; },

  _newPeer(id) {
    return new Promise((resolve, reject) => {
      if (typeof Peer === 'undefined') { reject(new Error('Networking library failed to load — check your connection.')); return; }
      const p = id ? new Peer(id, { debug: 1 }) : new Peer({ debug: 1 });
      const fail = err => { p.destroy(); reject(err); };
      p.once('open', () => { p.off('error', fail); resolve(p); });
      p.once('error', fail);
    });
  },

  async host() {
    this.leave(true);
    this.setStatus('Connecting…', 'warn');
    for (let tries = 0; tries < 5; tries++) {
      const code = Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[randInt(32)]).join('');
      try {
        this.peer = await this._newPeer(this.PREFIX + code);
        this.code = code; this.isHost = true; this.myId = this.peer.id; this.online = true;
        this.peer.on('connection', conn => this._accept(conn));
        this._watchPeer();
        this.setStatus('Hosting ' + code, 'on');
        return code;
      } catch (e) { if (e.type !== 'unavailable-id') { this.setStatus('Offline'); throw e; } }
    }
    throw new Error('Could not reserve a room code. Try again.');
  },

  async join(code) {
    this.leave(true);
    code = code.trim().toUpperCase();
    this.setStatus('Connecting…', 'warn');
    try { this.peer = await this._newPeer(); }
    catch (e) { this.setStatus('Offline'); throw e; }
    this.myId = this.peer.id; this.isHost = false; this.code = code;
    this._watchPeer();
    return new Promise((resolve, reject) => {
      const conn = this.peer.connect(this.PREFIX + code, { reliable: true, serialization: 'json' });
      const timer = setTimeout(() => { reject(new Error('Room not found or host unreachable.')); this.leave(true); }, 12000);
      this.peer.once('error', e => { clearTimeout(timer); reject(e.type === 'peer-unavailable' ? new Error(`No room with code ${code}.`) : e); this.setStatus('Offline'); });
      conn.on('open', () => {
        clearTimeout(timer); this.hostConn = conn; this.online = true;
        this.setStatus('In room ' + code, 'on');
        conn.on('data', msg => this._recv(msg, conn));
        conn.on('close', () => { if (this.hostConn === conn) { this.online = false; this.setStatus('Disconnected', 'warn'); this.emit('host-left', {}); } });
        resolve(code);
      });
    });
  },

  _watchPeer() {
    this.peer.on('disconnected', () => { if (this.peer && !this.peer.destroyed) { this.setStatus('Reconnecting…', 'warn'); try { this.peer.reconnect(); } catch {} } });
    this.peer.on('open', () => this.online && this.setStatus(this.isHost ? 'Hosting ' + this.code : 'In room ' + this.code, 'on'));
    this.peer.on('error', e => { if (e.type === 'network' || e.type === 'server-error') toast('Network problem: ' + e.message, 'err'); });
  },

  _accept(conn) {
    conn.on('open', () => {
      this.conns.set(conn.peer, conn);
      conn.on('data', msg => this._recv(msg, conn));
      conn.on('close', () => { this.conns.delete(conn.peer); this.emit('peer-left', { pid: conn.peer }); });
      conn.on('error', () => {});
      this.emit('peer-joined', { pid: conn.peer });
    });
  },

  _recv(msg, conn) {
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
    if (this.isHost) {
      msg.from = conn.peer; // never trust a client-supplied sender id
      if (msg.to && msg.to !== this.myId) { this.conns.get(msg.to)?.send(msg); return; }
      if (!msg.to) for (const [pid, c] of this.conns) if (pid !== conn.peer && c.open) c.send(msg);
    }
    this.emit(msg.type, msg);
  },

  /** Send to everyone else in the room. */
  broadcast(type, data = {}) {
    if (!this.online) return;
    const msg = { ...data, type, from: this.myId };
    if (this.isHost) { for (const c of this.conns.values()) if (c.open) c.send(msg); }
    else this.hostConn?.open && this.hostConn.send(msg);
  },
  /** Send to one peer (relayed through host if needed). */
  sendTo(pid, type, data = {}) {
    if (!this.online) return;
    const msg = { ...data, type, from: this.myId, to: pid };
    if (this.isHost) this.conns.get(pid)?.send(msg);
    else this.hostConn?.send(msg);
  },

  leave(silent) {
    if (this.peer) { if (!silent) this.broadcast('bye'); try { this.peer.destroy(); } catch {} }
    this.peer = null; this.hostConn = null; this.conns.clear(); this.isHost = false; this.online = false; this.code = null; this.myId = 'me';
    this.setStatus('Offline');
  },
};
