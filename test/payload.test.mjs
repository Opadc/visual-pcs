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

test('lanes carry every A+B symbol pair of a codeword pair exactly once', () => {
  const seen = new Set();
  let parity = 0;
  for (let p = 0; p < 8; p++) {
    for (let d = 0; d < P.LANE_PAIRS; d++) {
      const id = P.lanePairId(p, d);
      assert.equal(id.cw, 0);
      seen.add(id.j);
      if (id.j >= P.CW_K) parity++;
    }
  }
  assert.equal(seen.size, P.CW_N);
  assert.equal(parity, P.CW_N - P.CW_K);
  assert.equal(P.lanePairId(3, P.LANE_PAIRS).cw, 1);
});

test('a lane unit is 20 adjacent stream bits, about 2.5 characters', () => {
  P.setPayload('');
  // Pair j = 0 sits on lane 0: header bit + 'C' + 'a' + 3 bits of 'l'.
  const pair = P.lanePair(0, 0);
  assert.equal(P.bin(pair.a.value, 10) + P.bin(pair.b.value, 10),
    '1' + P.bin(0x43, 8) + P.bin(0x61, 8) + P.bin(0x6C, 8).slice(0, 3));
  const cover = P.coverLanePair(0, 0);
  assert.deepEqual(cover.map((c) => [String.fromCharCode(P.byteAt(c.idx)), c.n]), [['C', 8], ['a', 8], ['l', 3]]);
  assert.deepEqual(P.coverLanePair(0, P.LANE_PAIRS - 1), []);   // parity
});

test('word lookup and word parts', () => {
  P.setPayload('');
  const w = P.wordAround(10);                // inside 'Ishmael'
  assert.equal(w.text, 'Ishmael');
  assert.equal(P.wordAround(4), null);       // the space after 'Call'
  assert.ok(P.inWord(w.s + P.passageLength(), w), 'the passage repeats');
  // 'Ishmael' is bytes 8..14 = all of 66-bit block 1 except the space before it.
  assert.equal(P.wordPart(P.coverG66(1), w), 'Ishmael');
  // Pairs 3..6 sit on lanes 3..6 and each holds a slice of the word. Partial
  // characters count, so neighbouring slices overlap by one letter.
  assert.deepEqual([3, 4, 5, 6].map((p) => P.wordPart(P.coverLanePair(p, 0), w)), ['Is', 'shma', 'ael', 'l']);
  assert.equal(P.wordPart(P.coverLanePair(2, 0), w), '');
});

test('lane data index skips alignment markers', () => {
  const AP = P.AM_PERIOD;
  assert.equal(P.laneDataIndex(0), -1);
  assert.equal(P.laneDataIndex(AP), -1);
  assert.equal(P.laneDataIndex(1), 0);
  assert.equal(P.laneDataIndex(AP - 1), AP - 2);
  assert.equal(P.laneDataIndex(AP + 1), AP - 1);
});
