/* Bit-level model of the 200GBASE-R transmit path, following the IEEE P802.3bs
   D3.1 Clause 119 equations. The MAC sends a repeating ASCII passage as plain
   data bytes (no preamble, FCS or control characters). Scrambling is shown by
   colour only, so the bits here are the unscrambled ones. Pure functions, no DOM.

   One codeword pair q carries a 10280-bit block, tx_scrambled_am:
     with an AM group:    am_mapped<1027:0> then 36 x 257-bit blocks
     without an AM group: 40 x 257-bit blocks
   Pre-FEC distribution (119.2.4.5): message symbol i of m_A is bits 20i..20i+9,
   of m_B is bits 20i+10..20i+19. RS(544,514) appends 30 parity symbols.
   Symbol distribution (119.2.4.8): tx_out<8k+2j> = c_A<543-4k-j> on even k,
   c_B on odd k (tx_out<8k+2j+1> takes the other), and tx_out symbol s goes to
   PCS lane s mod 8. Bit 0 of every symbol is sent first. */
(function (P) {
  'use strict';

  P.PAYLOAD_DEFAULT = 'Call me Ishmael. Some years ago, never mind how long precisely, having little or no ' +
    'money in my purse, and nothing particular to interest me on shore, I thought I would sail about a ' +
    'little and see the watery part of the world. ';
  P.PAYLOAD_SOURCE = 'Herman Melville, Moby-Dick (1851)';

  P.CW_N = 544;                    // symbols per codeword
  P.CW_K = 514;                    // message (data) symbols per codeword
  P.CW_P = 30;                     // parity symbols per codeword
  P.PAIR_BITS = 10280;             // 2 x 514 x 10
  P.PAIR_SLOTS = 40;               // 257-bit block slots per codeword pair
  P.AM_BITS = 1028;                // 8 x 120 + 65 pad + 3 status = 4 x 257
  P.AM_SLOTS = 4;
  P.AM_PAIRS_STD = 2048;           // 81 920 blocks / 40 = one AM group every 2048 codeword pairs
  P.LANE_SYM = 136;                // symbols per PCS lane per codeword pair
  P.UNIT_SYM = 4;                  // symbols per lane cube in the scene
  // P.UNITS_PER_PAIR, P.AM_UNITS and P.AM_PAIRS come from model.js.

  // Table 119-1, octets {CM0,CM1,CM2,UP0,CM3,CM4,CM5,UP1,UM0,UM1,UM2,UP2,UM3,UM4,UM5}, each sent LSB first.
  P.AM_TABLE = [
    [0x9A, 0x4A, 0x26, 0x05, 0x65, 0xB5, 0xD9, 0xD6, 0xB3, 0xC0, 0x8C, 0x29, 0x4C, 0x3F, 0x73],
    [0x9A, 0x4A, 0x26, 0x04, 0x65, 0xB5, 0xD9, 0x67, 0x5A, 0xDE, 0x7E, 0x98, 0xA5, 0x21, 0x81],
    [0x9A, 0x4A, 0x26, 0x46, 0x65, 0xB5, 0xD9, 0xFE, 0x3E, 0xF3, 0x56, 0x01, 0xC1, 0x0C, 0xA9],
    [0x9A, 0x4A, 0x26, 0x5A, 0x65, 0xB5, 0xD9, 0x84, 0x86, 0x80, 0xD0, 0x7B, 0x79, 0x7F, 0x2F],
    [0x9A, 0x4A, 0x26, 0xE1, 0x65, 0xB5, 0xD9, 0x19, 0x2A, 0x51, 0xF2, 0xE6, 0xD5, 0xAE, 0x0D],
    [0x9A, 0x4A, 0x26, 0xF2, 0x65, 0xB5, 0xD9, 0x4E, 0x12, 0x4F, 0xD1, 0xB1, 0xED, 0xB0, 0x2E],
    [0x9A, 0x4A, 0x26, 0x3D, 0x65, 0xB5, 0xD9, 0xEE, 0x42, 0x9C, 0xA1, 0x11, 0xBD, 0x63, 0x5E],
    [0x9A, 0x4A, 0x26, 0x22, 0x65, 0xB5, 0xD9, 0x32, 0xD6, 0x76, 0x5B, 0xCD, 0x29, 0x89, 0xA4]
  ];
  P.AM_FIELDS = ['CM0', 'CM1', 'CM2', 'UP0', 'CM3', 'CM4', 'CM5', 'UP1', 'UM0', 'UM1', 'UM2', 'UP2', 'UM3', 'UM4', 'UM5'];

  var bytes = [];
  P.payloadVersion = 0;
  P.setPayload = function (text) {
    P.payloadVersion++;
    var s = text && text.length ? text : P.PAYLOAD_DEFAULT;
    bytes = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      bytes.push(c >= 32 && c < 127 ? c : 63);   // printable ASCII only; anything else becomes '?'
    }
    return bytes.length;
  };
  P.setPayload('');

  function mod(a, n) { return ((a % n) + n) % n; }
  P.mod = mod;
  P.byteAt = function (i) { return bytes[mod(i, bytes.length)]; };
  P.byteRange = function (start, len) {
    var out = [];
    for (var i = 0; i < len; i++) out.push(P.byteAt(start + i));
    return out;
  };

  P.isAmPair = function (q) { return mod(q, P.AM_PAIRS) === 0; };
  // AM pairs in [0, q): ceil(q / AM_PAIRS), also right for negative q.
  function amPairsBefore(q) { return Math.ceil(q / P.AM_PAIRS); }

  // 257-bit slot s of the stream after AM insertion.
  P.slot257 = function (s) {
    var q = Math.floor(s / P.PAIR_SLOTS), r = s - q * P.PAIR_SLOTS, am = P.isAmPair(q);
    if (am && r < P.AM_SLOTS) return { q: q, r: r, am: true };
    var m = q * P.PAIR_SLOTS - P.AM_SLOTS * amPairsBefore(q) + r - (am ? P.AM_SLOTS : 0);
    return { q: q, r: r, am: false, block: m };
  };
  // 66-bit slot t: four per 257-bit slot. AM slots hold idles that rate matching deletes.
  P.slot66 = function (t) {
    var s = P.slot257(Math.floor(t / 4));
    return s.am ? { idle: true, q: s.q } : { idle: false, block: 4 * s.block + mod(t, 4), q: s.q };
  };

  // am_mapped<b>, b = 0..1027 (119.2.4.4.1).
  function amBit(b) {
    if (b >= 1025) return { v: 0, src: 'sf', n: b - 1025 };
    if (b >= 960) return { v: (b * 7 + 3) % 5 < 2 ? 1 : 0, src: 'pad', n: b - 960 };   // stands in for PRBS9
    var t = Math.floor(b / 10), k = t >> 3, r = t & 7, j = r >> 1, h = r & 1;
    var x = (k % 2 === 0) === (h === 0) ? 2 * j : 2 * j + 1, n = 10 * k + b % 10;
    return { v: (P.AM_TABLE[x][n >> 3] >> (n & 7)) & 1, src: 'am', lane: x, n: n };
  }
  P.amFieldOf = function (n) { return P.AM_FIELDS[n >> 3]; };

  // Bit b (0..10279) of the 10280-bit block of codeword pair q.
  function pairBit(q, b) {
    var am = P.isAmPair(q);
    if (am && b < P.AM_BITS) return amBit(b);
    var local = b - (am ? P.AM_BITS : 0), slot = Math.floor(local / 257), o = local - slot * 257;
    var m = q * P.PAIR_SLOTS - P.AM_SLOTS * amPairsBefore(q) + slot;
    if (o === 0) return { v: 1, src: 'h', idx: m };
    var k = 32 * m + ((o - 1) >> 3), bit = (o - 1) & 7;
    return { v: (P.byteAt(k) >> bit) & 1, src: 'b', idx: k, bit: bit };
  }
  P.pairBit = pairBit;

  // 10 bits starting at bit b0, bit 0 first. parts groups runs from one source.
  function tenBits(q, b0) {
    var v = 0, parts = [], bits = '';
    for (var n = 0; n < 10; n++) {
      var s = pairBit(q, b0 + n), last = parts[parts.length - 1];
      v |= s.v << n; bits += s.v;
      var key = s.src === 'b' || s.src === 'h' ? s.src + s.idx : s.src === 'am' ? 'am' + s.lane + ':' + (s.n >> 3) : s.src;
      if (last && last.key === key) { last.n++; last.bits += s.v; }
      else parts.push({ key: key, src: s.src, idx: s.idx, lane: s.lane, field: s.src === 'am' ? P.amFieldOf(s.n) : null, n: 1, bits: String(s.v), first: s.bit });
    }
    return { value: v, bits: bits, parts: parts };
  }

  // Codeword symbol i (0 = sent first) of codeword w (0 = A, 1 = B) in pair q.
  P.cwSymbol = function (q, w, i) {
    if (i >= P.CW_K) return { q: q, w: w, i: i, parity: true, p: i - P.CW_K };
    var s = tenBits(q, 20 * i + 10 * w);
    s.q = q; s.w = w; s.i = i; s.parity = false;
    return s;
  };

  // Lane symbol k (0..135) of PCS lane p in pair q -> codeword symbol.
  P.laneSymbolId = function (p, k) {
    return { w: (k & 1) ^ (p & 1), i: 4 * k + (p >> 1) };
  };

  // Scene lane cube n on PCS lane p: pair q, cube u in pair, its 4 symbols.
  P.laneUnit = function (p, n) {
    var q = Math.floor(n / P.UNITS_PER_PAIR), u = n - q * P.UNITS_PER_PAIR, syms = [];
    for (var k = P.UNIT_SYM * u; k < P.UNIT_SYM * (u + 1); k++) {
      var id = P.laneSymbolId(p, k), s = P.cwSymbol(q, id.w, id.i);
      s.k = k; syms.push(s);
    }
    return { p: p, q: q, u: u, am: P.isAmPair(q) && u < P.AM_UNITS, syms: syms };
  };
  P.isAmUnit = function (n) {
    var u = mod(n, P.UNITS_PER_PAIR);
    return u < P.AM_UNITS && P.isAmPair(Math.floor(n / P.UNITS_PER_PAIR));
  };

  // Scene codeword cubes: 15 x 32 data symbols, then 34, then the 30 parity symbols.
  P.ROW_CUBES = [];
  (function () {
    for (var c = 0; c < 15; c++) P.ROW_CUBES.push([32 * c, 32 * c + 32]);
    P.ROW_CUBES.push([480, 514]);
    P.ROW_CUBES.push([514, 544]);
  })();
  P.ROW_PARITY = P.ROW_CUBES.length - 1;

  // ---- What each block carries, as byte indices: [{ idx, n }] ----
  var memo = new Map(), memoVer = -1;
  function cached(key, fn) {
    if (memoVer !== P.payloadVersion) { memo.clear(); memoVer = P.payloadVersion; }
    var v = memo.get(key);
    if (v === undefined) { v = fn(); if (memo.size > 8000) memo.clear(); memo.set(key, v); }
    return v;
  }
  function addSym(s, out) {
    if (s.parity) return out;
    s.parts.forEach(function (pt) {
      if (pt.src !== 'b') return;
      var last = out[out.length - 1];
      if (last && last.idx === pt.idx) last.n += pt.n;
      else out.push({ idx: pt.idx, n: pt.n });
    });
    return out;
  }
  function whole(start, len) {
    var out = [];
    for (var i = 0; i < len; i++) out.push({ idx: start + i, n: 8 });
    return out;
  }
  P.cover66 = function (t) { var s = P.slot66(t); return s.idle ? null : whole(8 * s.block, 8); };
  P.cover257 = function (s) { var sl = P.slot257(s); return sl.am ? null : whole(32 * sl.block, 32); };
  P.coverRow = function (q, w, c) {
    return cached('r' + q + ':' + w + ':' + c, function () {
      var out = [], r = P.ROW_CUBES[c];
      for (var i = r[0]; i < Math.min(r[1], P.CW_K); i++) addSym(P.cwSymbol(q, w, i), out);
      return out.sort(function (a, b) { return a.idx - b.idx; });
    });
  };
  P.coverLane = function (p, n) {
    return cached('l' + p + ':' + n, function () {
      var out = [];
      P.laneUnit(p, n).syms.forEach(function (s) { addSym(s, out); });
      return out.sort(function (a, b) { return a.idx - b.idx; });
    });
  };

  // ---- Words ----
  function isWordChar(c) { return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 39; }
  P.passageLength = function () { return bytes.length; };
  P.wordAround = function (i) {
    var L = bytes.length, k = mod(i, L);
    if (!isWordChar(bytes[k])) return null;
    var s = k, e = k + 1;
    while (s > 0 && isWordChar(bytes[s - 1])) s--;
    while (e < L && isWordChar(bytes[e])) e++;
    return { s: s, e: e, text: String.fromCharCode.apply(null, bytes.slice(s, e)) };
  };
  P.inWord = function (i, w) { var k = mod(i, bytes.length); return k >= w.s && k < w.e; };
  // Which letters of word w a block holds bits of, as a mask; null if none.
  P.wordMask = function (cover, w) {
    var L = bytes.length, has = new Array(w.e - w.s).fill(false), any = false;
    for (var i = 0; i < cover.length; i++) {
      if (!P.inWord(cover[i].idx, w)) continue;
      has[mod(cover[i].idx, L) - w.s] = true; any = true;
    }
    return any ? has : null;
  };
  P.wordPart = function (cover, w) {
    var m = P.wordMask(cover, w), s = '';
    if (m) m.forEach(function (on, i) { if (on) s += w.text[i]; });
    return s;
  };

  P.hex = function (v, digits) { return v.toString(16).toUpperCase().padStart(digits, '0'); };
  P.glyph = function (b) { return String.fromCharCode(b); };
})(globalThis.PCS = globalThis.PCS || {});
