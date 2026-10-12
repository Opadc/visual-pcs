import test from 'node:test';
import assert from 'node:assert/strict';
import '../src/js/model.js';
import '../src/js/rs.js';
import '../src/js/payload.js';

// Checks the bit model against the IEEE P802.3bs D3.1 Clause 119 equations.
const P = globalThis.PCS;
const bits10 = (v) => { let s = ''; for (let n = 0; n < 10; n++) s += (v >> n) & 1; return s; };
const byteBits = (b) => { let s = ''; for (let n = 0; n < 8; n++) s += (b >> n) & 1; return s; };   // LSB first

test('payload: empty input falls back to the default, non-ASCII becomes ?', () => {
  assert.equal(P.setPayload(''), P.PAYLOAD_DEFAULT.length);
  P.setPayload('Café—ok');
  assert.equal(String.fromCharCode(...P.byteRange(0, 7)), 'Caf??ok');
  P.setPayload('');
});

test('a codeword pair is 10280 bits: 1028-bit AM group + 36 blocks, or 40 blocks', () => {
  assert.equal(P.AM_BITS + 36 * 257, P.PAIR_BITS);
  assert.equal(40 * 257, P.PAIR_BITS);
  assert.equal(2 * P.CW_K * 10, P.PAIR_BITS);
  assert.equal(P.CW_N, P.CW_K + P.CW_P);
  assert.equal(P.AM_PAIRS_STD * 40, 81920);
});

test('AM insertion: slots 0-3 of an AM pair hold the group, data blocks continue around it', () => {
  P.setPayload('');
  const q = 0;   // AM pair in the lab (AM_PAIRS = 1)
  assert.ok(P.isAmPair(q));
  assert.deepEqual([0, 1, 2, 3].map((r) => P.slot257(r).am), [true, true, true, true]);
  assert.equal(P.slot257(4).block, 0);
  assert.equal(P.slot257(39).block, 35);
  assert.equal(P.slot257(44).block, 36);   // next pair: 4 more AM slots skipped
  // 66-bit slots under the AM group are idles that rate matching removed.
  assert.ok(P.slot66(0).idle && P.slot66(15).idle);
  assert.equal(P.slot66(16).block, 0);
});

test('am_mapped: each 10-bit symbol comes from one lane marker (119.2.4.4.1)', () => {
  // Symbol t = 8k + 2j + h takes am_{2j} on even k / h = 0, am_{2j+1} otherwise.
  for (let k = 0; k < 12; k++) for (let j = 0; j < 4; j++) for (let h = 0; h < 2; h++) {
    const t = 8 * k + 2 * j + h, x = (k % 2 === 0) === (h === 0) ? 2 * j : 2 * j + 1;
    for (let n = 0; n < 10; n++) {
      const b = P.pairBit(0, 10 * t + n), m = 10 * k + n;
      assert.equal(b.src, 'am'); assert.equal(b.lane, x);
      assert.equal(b.v, (P.AM_TABLE[x][m >> 3] >> (m & 7)) & 1);
    }
  }
  assert.equal(P.pairBit(0, 960).src, 'pad');
  assert.equal(P.pairBit(0, 1025).src, 'sf');
  assert.equal(P.pairBit(0, 1028).src, 'h');   // first data block header
});

test('pre-FEC distribution: m_A gets bits 20i..20i+9, m_B gets 20i+10..20i+19 (119.2.4.5)', () => {
  P.setPayload('');
  for (const i of [0, 51, 52, 100, 513]) {
    for (const w of [0, 1]) {
      const s = P.cwSymbol(0, w, i);
      let want = '';
      for (let n = 0; n < 10; n++) want += P.pairBit(0, 20 * i + 10 * w + n).v;
      assert.equal(bits10(s.value), want);
      assert.equal(s.bits, want);
    }
  }
  assert.ok(P.cwSymbol(0, 0, 514).parity);
  assert.equal(P.cwSymbol(0, 1, 543).p, 29);
});

test('data bytes survive: blocks after the AM group rebuild the passage, LSB first', () => {
  P.setPayload('');
  let bits = '';
  for (let i = 0; i < P.CW_K; i++) for (const w of [0, 1]) bits += P.cwSymbol(0, w, i).bits;
  for (let m = 0; m < 36; m++) {
    const blk = bits.slice(P.AM_BITS + 257 * m, P.AM_BITS + 257 * (m + 1));
    assert.equal(blk[0], '1');
    let want = '';
    for (const b of P.byteRange(32 * m, 32)) want += byteBits(b);
    assert.equal(blk.slice(1), want, 'block ' + m);
  }
});

test('symbol distribution: each PCS lane opens with its own alignment marker (119.2.4.8)', () => {
  for (let p = 0; p < 8; p++) {
    let lane = '';
    for (let k = 0; k < 12; k++) {
      const id = P.laneSymbolId(p, k);
      lane += P.cwSymbol(0, id.w, id.i).bits;
    }
    let want = '';
    for (const b of P.AM_TABLE[p]) want += byteBits(b);
    assert.equal(lane, want, 'lane ' + p);
  }
});

test('symbol distribution: every codeword symbol goes to exactly one lane slot; parity 7 or 8 per lane', () => {
  const seen = new Set(), parity = [];
  for (let p = 0; p < 8; p++) {
    let par = 0;
    for (let k = 0; k < P.LANE_SYM; k++) {
      const id = P.laneSymbolId(p, k);
      seen.add(id.w + ':' + id.i);
      if (id.i >= P.CW_K) par++;
    }
    parity.push(par);
  }
  assert.equal(seen.size, 2 * P.CW_N);
  assert.deepEqual(parity, [7, 7, 7, 7, 8, 8, 8, 8]);
  // Matches tx_out<8k+2j> = c_A<543-4k-j> on even k: lane 0 takes A0, B4, A8 ...
  assert.deepEqual([0, 1, 2].map((k) => P.laneSymbolId(0, k)), [{ w: 0, i: 0 }, { w: 1, i: 4 }, { w: 0, i: 8 }]);
  assert.deepEqual([0, 1].map((k) => P.laneSymbolId(1, k)), [{ w: 1, i: 0 }, { w: 0, i: 4 }]);
});

test('scene units: lane cubes, AM cubes and codeword cubes line up', () => {
  assert.equal(P.UNITS_PER_PAIR * P.UNIT_SYM, P.LANE_SYM);
  assert.equal(P.AM_UNITS * P.UNIT_SYM * 10, 120);
  assert.deepEqual([0, 2, 3, 34].map(P.isAmUnit), [true, true, false, true]);
  assert.equal(P.ROW_CUBES.reduce((a, r) => a + r[1] - r[0], 0), P.CW_N);
  assert.deepEqual(P.ROW_CUBES[P.ROW_PARITY], [514, 544]);
});

test('word lookup and covers', () => {
  P.setPayload('');
  const w = P.wordAround(10);
  assert.equal(w.text, 'Ishmael');
  assert.equal(P.wordAround(4), null);
  assert.equal(P.wordPart(P.cover66(16 + 1), w), 'Ishmael');   // 66-bit block 1 follows 16 idle slots
  assert.equal(P.cover66(3), null);
  // The word is spread over several PCS lanes in the first data cubes of pair 0.
  const lanes = new Set();
  for (let p = 0; p < 8; p++) for (let n = 3; n < 8; n++) if (P.wordPart(P.coverLane(p, n), w)) lanes.add(p);
  assert.ok(lanes.size >= 4, 'spread over ' + lanes.size + ' lanes');
});
