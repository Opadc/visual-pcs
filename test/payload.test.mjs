import test from 'node:test';
import assert from 'node:assert/strict';
import '../src/js/model.js';
import '../src/js/payload.js';

const P = globalThis.PCS;
const text = (arr) => String.fromCharCode(...arr);

test('payload: empty input falls back to the default, non-ASCII becomes ?', () => {
  assert.equal(P.setPayload(''), P.PAYLOAD_DEFAULT.length);
  P.setPayload('Café—ok');
  assert.equal(text(P.byteRange(0, 7)), 'Caf??ok');
  P.setPayload('');
});

test('200GMII transfer, 66-bit block and 257-bit block carry the same bytes', () => {
  assert.equal(text(P.miiBytes(0)), 'Call me ');
  assert.deepEqual(P.block66(3).bytes, P.miiBytes(3));
  const b = P.block257(1);
  assert.deepEqual(b.bytes, [4, 5, 6, 7].flatMap((n) => P.block66(n).bytes));
  assert.equal(b.hdr, '1');
});

test('data symbols of a codeword pair rebuild the 257-bit blocks', () => {
  const cw = 2;
  let bits = '';
  for (let j = 0; j < P.CW_K; j++) {
    for (const w of [0, 1]) bits += P.bin(P.cwSymbol(cw, w, j).value, 10);
  }
  assert.equal(bits.length, P.PAIR_BLOCKS * 257);
  for (let k = 0; k < P.PAIR_BLOCKS; k++) {
    const blk = bits.slice(k * 257, (k + 1) * 257);
    assert.equal(blk[0], '1');
    const bytes = [];
    for (let i = 0; i < 32; i++) bytes.push(parseInt(blk.slice(1 + 8 * i, 9 + 8 * i), 2));
    assert.deepEqual(bytes, P.block257(cw * P.PAIR_BLOCKS + k).bytes);
  }
});

test('a symbol reports the characters its bits came from', () => {
  // Stream symbol 0 = header bit + top 9 bits of 'C' (0x43) and 'a' (0x61).
  const s = P.streamSymbol(0);
  assert.equal(s.parts[0].src, 'h');
  assert.equal(s.parts[1].src, 'b');
  assert.equal(P.byteAt(s.parts[1].idx), 'C'.charCodeAt(0));
  assert.equal(s.parts[1].n, 8);
  assert.equal(s.parts[2].n, 1);
  assert.equal(s.value, parseInt('1' + '01000011' + '0', 2));
});

test('lanes carry every symbol of a codeword pair exactly once', () => {
  const seen = new Set();
  let parity = 0;
  for (let p = 0; p < 8; p++) {
    for (let d = 0; d < P.LANE_SYM_PER_PAIR; d++) {
      const id = P.laneSymbolId(p, d);
      assert.equal(id.cw, 0);
      seen.add(`${id.w}:${id.j}`);
      if (id.j >= P.CW_K) parity++;
    }
  }
  assert.equal(seen.size, 2 * P.CW_N);
  assert.equal(parity, 2 * (P.CW_N - P.CW_K));
  // Each lane alternates A, B, A, B.
  assert.deepEqual([0, 1, 2, 3].map((d) => P.laneSymbolId(5, d).w), [0, 1, 0, 1]);
});

test('lane data index skips alignment markers', () => {
  const AP = P.AM_PERIOD;
  assert.equal(P.laneDataIndex(0), -1);
  assert.equal(P.laneDataIndex(AP), -1);
  assert.equal(P.laneDataIndex(1), 0);
  assert.equal(P.laneDataIndex(AP - 1), AP - 2);
  assert.equal(P.laneDataIndex(AP + 1), AP - 1);
});
