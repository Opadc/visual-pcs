/* Describes what a picked block carries at the point where it was clicked.
   Returns plain data; inspector.js turns it into HTML. */
(function (P) {
  'use strict';

  function stageAt(x) {
    var best = null;
    P.BOXES.forEach(function (b) { if (!best && x >= b.x[0] - 0.75 && x <= b.x[1] + 0.75) best = b; });
    if (best) return best.name;
    var X = P.X;
    if (x > X.chan[0] && x < X.chan[1]) return 'Physical SerDes lane';
    if (x > X.lanesStart && x < X.mux[0]) return 'PCS lane';
    return 'In transit';
  }

  // Which characters a set of symbols touches, in text order.
  function sourcesOf(syms) {
    var seen = {}, order = [];
    syms.forEach(function (s) {
      if (s.parity) return;
      s.parts.forEach(function (pt) {
        if (pt.src === 'b' && !seen[pt.idx]) { seen[pt.idx] = 1; order.push(pt.idx); }
      });
    });
    return order.sort(function (a, b) { return a - b; });
  }

  function symbolInfo(s) {
    var out = { w: s.w, i: s.i, k: s.k, parity: !!s.parity };
    if (s.parity) { out.p = s.p; return out; }
    out.hex = P.hex(s.value, 3); out.bits = s.bits;
    out.parts = s.parts.map(function (pt) {
      if (pt.src === 'b') return { kind: 'byte', idx: pt.idx, ch: P.byteAt(pt.idx), n: pt.n, bits: pt.bits };
      if (pt.src === 'h') return { kind: 'hdr', block: pt.idx, n: pt.n, bits: pt.bits };
      if (pt.src === 'am') return { kind: 'am', lane: pt.lane, field: pt.field, n: pt.n, bits: pt.bits };
      return { kind: pt.src, n: pt.n, bits: pt.bits };
    });
    return out;
  }
  P.symbolInfo = symbolInfo;

  // Characters a drawn block carries (byte indices with bit counts), or null.
  P.coverOf = function (m) {
    if (!m) return null;
    if (m.fam === 'b66') return P.cover66(m.t);
    if (m.fam === 'b257') return P.cover257(m.s);
    if (m.fam === 'row') return m.c === P.ROW_PARITY ? null : P.coverRow(m.q, m.w, m.c);
    if (m.fam === 'lane') return P.coverLane(m.p, m.n);
    return null;
  };

  P.describePacket = function (m) {
    if (!m) return null;
    var S = P.state;
    var side = m.x < P.X.muxIn ? 'TX' : m.x > P.X.demux[0] ? 'RX' : 'Channel';
    var out = { where: stageAt(m.x), side: side, state: m.state };

    if (m.fam === 'b66') {
      var sl = P.slot66(m.t);
      if (sl.idle) {
        out.kind = 'idle'; out.title = 'Idle';
        return out;
      }
      out.kind = m.seg === 'mii' ? 'mii' : 'b66';
      out.title = (m.seg === 'mii' ? '200GMII transfer ' : '66-bit block ') + sl.block;
      out.start = 8 * sl.block; out.cover = P.cover66(m.t);
      return out;
    }
    if (m.fam === 'amg') {
      out.kind = 'amgroup'; out.title = 'Alignment marker group, codeword pair ' + m.q;
      return out;
    }
    if (m.fam === 'b257') {
      var s = P.slot257(m.s);
      out.kind = 'b257'; out.title = '257-bit block ' + s.block;
      out.start = 32 * s.block; out.cover = P.cover257(m.s);
      out.scrambled = !!m.scr; out.from66 = [4 * s.block, 4 * s.block + 3];
      out.pair = s.q; out.slot = s.r;
      return out;
    }
    if (m.fam === 'row') {
      var r = P.ROW_CUBES[m.c], syms = [];
      for (var i = r[0]; i < r[1]; i++) syms.push(symbolInfo(P.cwSymbol(m.q, m.w, i)));
      out.kind = 'cw'; out.q = m.q; out.w = m.w; out.r = r;
      out.title = 'Codeword ' + (m.w ? 'B' : 'A') + ', pair ' + m.q + ', symbols ' + r[0] + '–' + (r[1] - 1);
      out.symbols = syms;
      out.parityCount = syms.filter(function (x) { return x.parity; }).length;
      out.amCount = syms.filter(function (x) { return !x.parity && x.parts.some(function (pt) { return pt.kind === 'am'; }); }).length;
      out.sources = sourcesOf(syms.map(function (x, n) { return x.parity ? { parity: true } : P.cwSymbol(m.q, m.w, r[0] + n); }));
      out.cover = P.coverOf(m);
      return out;
    }
    if (m.fam === 'lane') {
      var u = P.laneUnit(m.p, m.n), lane = S.link.lanes[m.p];
      out.kind = 'lane'; out.am = u.am; out.q = u.q; out.u = u.u;
      out.title = 'PCS lane ' + m.p + ', symbols ' + (P.UNIT_SYM * u.u) + '–' + (P.UNIT_SYM * u.u + P.UNIT_SYM - 1) + ' of pair ' + u.q;
      out.symbols = u.syms.map(symbolInfo);
      out.cover = P.coverLane(m.p, m.n);
      out.lane = { pcs: m.p, serdes: lane.serdes, slot: lane.slot, k: S.link.k, rxPma: lane.rxPma };
      return out;
    }
    return out;
  };
})(globalThis.PCS = globalThis.PCS || {});
