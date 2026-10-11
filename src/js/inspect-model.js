/* Describes what a picked block carries at the point where it was clicked.
   Returns plain data; inspector.js turns it into HTML. */
(function (P) {
  'use strict';

  function stageAt(x) {
    var best = null;
    P.BOXES.forEach(function (b) { if (x >= b.x[0] - 0.75 && x <= b.x[1] + 0.75 && !best) best = b; });
    if (best) return best.name;
    var X = P.X;
    if (x > X.chan[0] && x < X.chan[1]) return 'Physical SerDes lane';
    if (x > X.lanesStart && x < X.mux[0]) return 'PCS lane, between symbol distribution and the PMA';
    return 'In transit';
  }

  function chars(bytes) { return bytes.map(P.glyph).join(''); }
  function hexBytes(bytes) { return bytes.map(function (b) { return P.hex(b, 2); }).join(' '); }

  // Which characters a set of symbols touches, and how many bits of each.
  function sourcesOf(syms) {
    var map = {}, order = [];
    syms.forEach(function (s) {
      if (s.parity) return;
      s.parts.forEach(function (pt) {
        if (pt.src !== 'b') return;
        if (!map[pt.idx]) { map[pt.idx] = 0; order.push(pt.idx); }
        map[pt.idx] += pt.n;
      });
    });
    order.sort(function (a, b) { return a - b; });
    return order.map(function (i) { return { idx: i, ch: P.byteAt(i), bits: map[i] }; });
  }

  function symbolInfo(s) {
    if (s.parity) return { parity: true, cw: s.cw, w: s.w, j: s.j };
    return {
      parity: false, cw: s.cw, w: s.w, j: s.j, value: s.value,
      hex: P.hex(s.value, 3), bin: P.bin(s.value, 10),
      parts: s.parts.map(function (pt) {
        return pt.src === 'h'
          ? { kind: 'hdr', block: pt.idx, bits: pt.bits }
          : { kind: 'byte', ch: P.byteAt(pt.idx), idx: pt.idx, n: pt.n, hi: pt.hi, lo: pt.lo, bits: pt.bits, whole: pt.n === 8 };
      })
    };
  }

  P.describePacket = function (m) {
    if (!m) return null;
    var S = P.state, where = stageAt(m.x), seg = m.seg != null ? P.SEGS[m.seg] : null;
    var side = m.x < P.X.muxIn ? 'TX' : m.x > P.X.demux[0] ? 'RX' : 'Channel';
    var out = { where: where, side: side, state: m.state };

    if (m.fam === 'g66') {
      var b = P.block66(m.n);
      out.kind = seg.kind === 'mii' ? 'mii' : 'b66';
      out.title = seg.kind === 'mii' ? '200GMII transfer ' + m.n : '66-bit block ' + m.n;
      out.bytes = b.bytes; out.ascii = chars(b.bytes); out.hex = hexBytes(b.bytes);
      out.hdr = b.hdr; out.readable = true;
      return out;
    }
    if (m.fam === 'amg') {
      out.kind = 'amgroup'; out.title = 'Alignment marker group';
      out.readable = false;
      return out;
    }
    if (m.fam === 'g257') {
      var blk = P.block257(m.n);
      out.kind = 'b257'; out.title = '257-bit block ' + m.n;
      out.bytes = blk.bytes; out.ascii = chars(blk.bytes); out.hex = hexBytes(blk.bytes);
      out.hdr = blk.hdr; out.from66 = [blk.first66, blk.first66 + 3];
      out.scrambled = !!seg.scr; out.readable = true;
      return out;
    }
    if (m.fam === 'row') {
      var id = P.chunkId(m.n), w = m.row, j0 = id.c * P.CHUNK, syms = [];
      for (var j = j0; j < Math.min(j0 + P.CHUNK, P.CW_N); j++) syms.push(P.cwSymbol(id.cw, w, j));
      out.kind = 'cw'; out.readable = false;
      out.title = 'Codeword ' + (w ? 'B' : 'A') + ', pair ' + id.cw + ', symbols ' + j0 + '–' + (j0 + syms.length - 1);
      out.cw = id.cw; out.w = w; out.j0 = j0;
      out.symbols = syms.map(symbolInfo);
      out.parityCount = syms.filter(function (s) { return s.parity; }).length;
      out.sources = sourcesOf(syms);
      return out;
    }
    if (m.fam === 'lane') {
      var lane = S.link.lanes[m.p], d = P.laneDataIndex(m.n);
      out.lane = { pcs: m.p, serdes: lane.serdes, slot: lane.slot, k: S.link.k, rxPma: lane.rxPma, rxSerdes: lane.rxSerdes };
      if (d < 0) {
        out.kind = 'am'; out.title = 'Alignment marker, PCS lane ' + m.p; out.readable = false;
        return out;
      }
      var s = P.laneSymbol(m.p, d);
      out.kind = 'sym'; out.readable = false;
      out.title = 'PCS lane ' + m.p + ', symbol ' + d;
      out.symbol = symbolInfo(s);
      out.sources = sourcesOf([s]);
      return out;
    }
    return null;
  };
})(globalThis.PCS = globalThis.PCS || {});
