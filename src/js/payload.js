/* What each block in the scene carries. The MAC sends a repeating ASCII text as
   plain data bytes (no preamble, FCS, idles or other control characters).
   64B/66B, 256B/257B and scrambling keep the bytes intact here; scrambling is
   shown by colour only. From pre-FEC distribution onward the stream is cut into
   10-bit symbols, so characters are no longer visible until post-FEC interleave.
   Pure functions, no DOM. */
(function (P) {
  'use strict';

  P.PAYLOAD_DEFAULT = 'Call me Ishmael. Some years ago--never mind how long precisely--having little or no ' +
    'money in my purse, and nothing particular to interest me on shore, I thought I would sail about a ' +
    'little and see the watery part of the world. ';
  P.PAYLOAD_SOURCE = 'Herman Melville, Moby-Dick (1851)';

  P.CW_N = 544;                       // RS(544,514) symbols per codeword
  P.CW_K = 514;                       // data symbols per codeword
  P.PAIR_BLOCKS = 40;                 // 2 x 514 x 10 bits = 40 x 257-bit blocks
  P.LANE_SYM_PER_PAIR = 2 * P.CW_N / P.N_PCS;   // 136 symbols per PCS lane per codeword pair
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

  // Symbol d on PCS lane p. Simplified distribution: each lane takes one symbol
  // from codeword A, then one from codeword B, in round-robin lane order.
  P.laneSymbolId = function (p, d) {
    var cw = Math.floor(d / P.LANE_SYM_PER_PAIR), e = d - cw * P.LANE_SYM_PER_PAIR;
    return { cw: cw, w: e & 1, j: (e >> 1) * P.N_PCS + p };
  };
  P.laneSymbol = function (p, d) {
    var id = P.laneSymbolId(p, d);
    return P.cwSymbol(id.cw, id.w, id.j);
  };

  // Codeword cube n of row w covers symbols CHUNK*c .. CHUNK*c+31 of codeword w in pair cw.
  P.chunkId = function (n) {
    var cw = Math.floor(n / P.CHUNKS);
    return { cw: cw, c: n - cw * P.CHUNKS };
  };

  P.hex = function (v, digits) { return v.toString(16).toUpperCase().padStart(digits, '0'); };
  P.bin = function (v, n) { return v.toString(2).padStart(n, '0'); };
  P.glyph = function (b) { return b === 32 ? '·' : String.fromCharCode(b); };
})(globalThis.PCS = globalThis.PCS || {});
