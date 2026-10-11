/* What each block in the scene carries. The MAC sends a repeating ASCII text as
   plain data bytes (no preamble, FCS, idles or other control characters).
   64B/66B, 256B/257B and scrambling keep the bytes intact here; scrambling is
   shown by colour only. From pre-FEC distribution onward the stream is cut into
   10-bit symbols, so characters are no longer visible until post-FEC interleave.
   Pure functions, no DOM. */
(function (P) {
  'use strict';

  P.PAYLOAD_DEFAULT = 'Call me Ishmael. Some years ago, never mind how long precisely, having little or no ' +
    'money in my purse, and nothing particular to interest me on shore, I thought I would sail about a ' +
    'little and see the watery part of the world. ';
  P.PAYLOAD_SOURCE = 'Herman Melville, Moby-Dick (1851)';

  P.CW_N = 544;                       // RS(544,514) symbols per codeword
  P.CW_K = 514;                       // data symbols per codeword
  P.PAIR_BLOCKS = 40;                 // 2 x 514 x 10 bits = 40 x 257-bit blocks
  P.LANE_SYM_PER_PAIR = 2 * P.CW_N / P.N_PCS;   // 136 symbols per PCS lane per codeword pair
  P.LANE_PAIRS = P.CW_N / P.N_PCS;              // 68 A+B symbol pairs per PCS lane per codeword pair
  P.CHUNK = 32;                       // symbols per codeword cube in the scene
  P.CHUNKS = Math.ceil(P.CW_N / P.CHUNK);       // 17 cubes per codeword; the last holds the parity

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
  P.byteAt = function (i) { return bytes[mod(i, bytes.length)]; };
  P.byteRange = function (start, len) {
    var out = [];
    for (var i = 0; i < len; i++) out.push(P.byteAt(start + i));
    return out;
  };

  // 200GMII transfer n and 66-bit block n carry the same 8 bytes; 257-bit block m carries 66-bit blocks 4m..4m+3.
  P.miiBytes = function (n) { return P.byteRange(8 * n, 8); };
  P.block66 = function (n) { return { hdr: '01', bytes: P.byteRange(8 * n, 8) }; };
  P.block257 = function (m) { return { hdr: '1', bytes: P.byteRange(32 * m, 32), first66: 4 * m }; };

  // Bit b of the transcoded stream. Each 257-bit block is a 1-bit header (1 = all four
  // 66-bit blocks are data) followed by 32 bytes, each sent MSB first in this model.
  function streamBit(b) {
    var m = Math.floor(b / 257), o = b - m * 257;
    if (o === 0) return { v: 1, src: 'h', idx: m };
    var k = 32 * m + ((o - 1) >> 3), bit = 7 - ((o - 1) & 7);
    return { v: (P.byteAt(k) >> bit) & 1, src: 'b', idx: k, bit: bit };
  }

  // 10-bit symbol t of the stream, with the bytes (or header bits) its bits came from.
  P.streamSymbol = function (t) {
    var v = 0, parts = [];
    for (var i = 0; i < 10; i++) {
      var s = streamBit(10 * t + i), last = parts[parts.length - 1];
      v = (v << 1) | s.v;
      if (last && last.src === s.src && last.idx === s.idx) { last.n++; last.lo = s.bit; last.bits += s.v; }
      else parts.push({ src: s.src, idx: s.idx, n: 1, hi: s.bit, lo: s.bit, bits: String(s.v) });
    }
    return { value: v, parts: parts };
  };

  // Symbol j of codeword A (w = 0) or B (w = 1) in codeword pair cw. Pre-FEC
  // distribution alternates 10-bit symbols between A and B.
  P.cwSymbol = function (cw, w, j) {
    if (j >= P.CW_K) return { cw: cw, w: w, j: j, parity: true };
    var s = P.streamSymbol(cw * 2 * P.CW_K + 2 * j + w);
    s.cw = cw; s.w = w; s.j = j; s.parity = false;
    return s;
  };

  // Data unit n on a PCS lane: every AM_PERIOD-th unit is that lane's alignment
  // marker, the rest are symbols. Returns -1 for an AM.
  P.laneDataIndex = function (n) {
    if (mod(n, P.AM_PERIOD) === 0) return -1;
    return n - Math.floor(n / P.AM_PERIOD) - 1;
  };

  // Unit d on PCS lane p is one A+B symbol pair. Symbol distribution deals
  // pairs round-robin: pair j of the codeword pair goes to lane j mod 8. A_j
  // and B_j are stream symbols 2j and 2j+1, so a pair is 20 adjacent stream
  // bits, about 2.5 characters.
  P.lanePairId = function (p, d) {
    var cw = Math.floor(d / P.LANE_PAIRS);
    return { cw: cw, j: (d - cw * P.LANE_PAIRS) * P.N_PCS + p };
  };
  P.lanePair = function (p, d) {
    var id = P.lanePairId(p, d);
    return { cw: id.cw, j: id.j, parity: id.j >= P.CW_K,
             a: P.cwSymbol(id.cw, 0, id.j), b: P.cwSymbol(id.cw, 1, id.j) };
  };

  // Codeword cube n of row w covers symbols CHUNK*c .. CHUNK*c+31 of codeword w in pair cw.
  P.chunkId = function (n) {
    var cw = Math.floor(n / P.CHUNKS);
    return { cw: cw, c: n - cw * P.CHUNKS };
  };

  // Bytes whose bits fall in stream bits [b0, b0 + n): [{ idx, n }], in order.
  function coverBits(b0, n, out) {
    for (var b = b0; b < b0 + n; b++) {
      var s = streamBit(b);
      if (s.src !== 'b') continue;
      var last = out[out.length - 1];
      if (last && last.idx === s.idx) last.n++;
      else out.push({ idx: s.idx, n: 1 });
    }
    return out;
  }
  function symBits(cw, w, j) { return (cw * 2 * P.CW_K + 2 * j + w) * 10; }

  // Which characters each kind of block carries, as absolute byte indices.
  var memo = new Map(), memoVer = -1;
  function cached(key, fn) {
    if (memoVer !== P.payloadVersion) { memo.clear(); memoVer = P.payloadVersion; }
    var v = memo.get(key);
    if (!v) { v = fn(); if (memo.size > 6000) memo.clear(); memo.set(key, v); }
    return v;
  }
  function whole(start, len) {
    var out = [];
    for (var i = 0; i < len; i++) out.push({ idx: start + i, n: 8 });
    return out;
  }
  P.coverG66 = function (n) { return whole(8 * n, 8); };
  P.coverG257 = function (m) { return whole(32 * m, 32); };
  P.coverChunk = function (cw, w, c) {
    return cached('c' + cw + ':' + w + ':' + c, function () {
      var out = [];
      for (var j = c * P.CHUNK; j < Math.min((c + 1) * P.CHUNK, P.CW_K); j++) coverBits(symBits(cw, w, j), 10, out);
      return out;
    });
  };
  P.coverLanePair = function (p, d) {
    var id = P.lanePairId(p, d);
    if (id.j >= P.CW_K) return [];
    return cached('l' + id.cw + ':' + id.j, function () { return coverBits(symBits(id.cw, 0, id.j), 20, []); });
  };

  // The word around byte i, in passage offsets (the passage repeats).
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
  // Characters of word w present in a cover list, e.g. 'Ish'. '' if none.
  // The same, as a mask over the word: which letters this block holds bits of.
  P.wordMask = function (cover, w) {
    var L = bytes.length, has = new Array(w.e - w.s).fill(false), any = false;
    for (var i = 0; i < cover.length; i++) {
      if (!P.inWord(cover[i].idx, w)) continue;
      has[mod(cover[i].idx, L) - w.s] = true; any = true;
    }
    return any ? has : null;
  };
  P.wordPart = function (cover, w) {
    var s = '';
    for (var i = 0; i < cover.length; i++) if (P.inWord(cover[i].idx, w)) s += String.fromCharCode(P.byteAt(cover[i].idx));
    return s;
  };

  P.hex = function (v, digits) { return v.toString(16).toUpperCase().padStart(digits, '0'); };
  P.bin = function (v, n) { return v.toString(2).padStart(n, '0'); };
  P.glyph = function (b) { return String.fromCharCode(b); };
})(globalThis.PCS = globalThis.PCS || {});
