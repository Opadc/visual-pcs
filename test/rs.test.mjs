import test from 'node:test';
import assert from 'node:assert/strict';
import '../src/js/model.js';
import '../src/js/rs.js';
import '../src/js/payload.js';

const P = globalThis.PCS;

test('RS(544,514) generator matches the 802.3bj encoder C model (langhammer_3bj_01_0912)', () => {
  assert.deepEqual(P.RS_GEN, [575, 552, 187, 230, 552, 1, 108, 565, 282, 249, 593, 132, 94, 720, 495, 385,
    942, 503, 883, 361, 788, 610, 193, 392, 127, 185, 158, 128, 834, 523]);
});

test('RS encode is systematic and every codeword has zero syndromes', () => {
  const msg = Array.from({ length: 514 }, (_, k) => 1023 - k);   // the C model's test pattern
  const par = P.rsParity(msg);
  assert.equal(par.length, 30);
  assert.ok(par.every((v) => v >= 0 && v < 1024));
  assert.deepEqual(P.rsSyndromes(msg.concat(par)), new Array(30).fill(0));
  // One wrong symbol shows up in the syndromes.
  const bad = msg.concat(par); bad[100] ^= 1;
  assert.ok(P.rsSyndromes(bad).some((s) => s !== 0));
});

test('model codewords: parity symbols are real RS parity over the message symbols', () => {
  P.setPayload('');
  for (const q of [0, 1]) for (const w of [0, 1]) {
    const cw = [];
    for (let i = 0; i < P.CW_N; i++) cw.push(P.cwSymbol(q, w, i).value);
    assert.deepEqual(P.rsSyndromes(cw), new Array(30).fill(0), 'pair ' + q + ' codeword ' + w);
    const s = P.cwSymbol(q, w, 514);
    assert.ok(s.parity);
    assert.equal(s.bits.length, 10);
    assert.equal(parseInt([...s.bits].reverse().join(''), 2), s.value);   // bit 0 first
  }
});
