import test from 'node:test';
import assert from 'node:assert/strict';
import '../src/js/model.js';
import '../src/js/fec.js';

const P = globalThis.PCS;
const skew0 = [0, 0, 0, 0, 0, 0, 0, 0];

test('every preset maps each PCS lane to exactly one SerDes slot', () => {
  for (const w of [8, 4, 2]) {
    for (const preset of Object.keys(P.PRESETS)) {
      const m = P.mapLanes(w, preset);
      const seen = new Set(m.map(l => `${l.serdes}:${l.slot}`));
      assert.equal(seen.size, 8, `${w} ${preset}`);
      for (const l of m) {
        assert.ok(l.serdes >= 0 && l.serdes < w);
        assert.ok(l.slot >= 0 && l.slot < 8 / w);
      }
    }
  }
});

test('grouped 4-lane mapping pairs adjacent PCS lanes', () => {
  const m = P.mapLanes(4, 'grouped');
  assert.deepEqual(m.map(l => l.serdes), [0, 0, 1, 1, 2, 2, 3, 3]);
  const i = P.mapLanes(4, 'interleaved');
  assert.deepEqual(i.map(l => l.serdes), [0, 1, 2, 3, 0, 1, 2, 3]);
});

test('RX PMA order is a permutation under rotation and swap', () => {
  for (const w of [8, 4, 2]) {
    const link = P.buildLink({ width: w, preset: 'remapped', swap: true, rot: [1, 2, 3, 0, 1, 0, 1, 0], skewNs: skew0 });
    assert.deepEqual([...link.byRxPma].sort(), [0, 1, 2, 3, 4, 5, 6, 7]);
  }
});

test('lanes sharing a SerDes lane share its skew', () => {
  const link = P.buildLink({ width: 2, preset: 'grouped', swap: false, rot: [], skewNs: [0, 200] });
  assert.equal(link.spreadNs, 200);
  assert.equal(link.deskewOk, false);
  assert.deepEqual(link.lanes.map(l => l.deskewFail), [false, false, false, false, true, true, true, true]);
  const ok = P.buildLink({ width: 2, preset: 'grouped', swap: false, rot: [], skewNs: [0, 150] });
  assert.equal(ok.deskewOk, true);
});

test('warp and unwarp are inverses and deskew re-aligns lanes', () => {
  const link = P.buildLink({ width: 4, preset: 'grouped', swap: false, rot: [], skewNs: [0, 40, 120, 10] });
  for (const lane of link.lanes) {
    const segs = P.laneSegments(link, lane);
    for (const x of [10, 45, 50, 60, 69, 76, 90]) {
      assert.ok(Math.abs(P.warp(P.unwarp(x, segs), segs) - x) < 1e-9);
    }
  }
  // After deskew every lane has the same total delay.
  const totals = link.lanes.map(l => P.laneSegments(link, l).reduce((a, g) => a + g.delay, 0));
  for (const t of totals) assert.ok(Math.abs(t - totals[0]) < 1e-9);
});

test('AM lock drops after 5 bad AMs in a row (Figure 119-12) and re-acquires', () => {
  assert.equal(P.AM_LOSS_COUNT, 5);
  const L = { state: 'locked', good: 0, bad: 0 };
  for (let i = 0; i < 4; i++) P.amLockStep(L, false);
  assert.equal(P.lockView(L), 'checking');
  P.amLockStep(L, true);
  assert.equal(L.bad, 0, 'a good AM resets amp_bad_count');
  for (let i = 0; i < 5; i++) P.amLockStep(L, false);
  assert.equal(L.state, 'searching');
  assert.equal(P.lockView(L), 'nolock');
  P.amLockStep(L, true); P.amLockStep(L, true);
  assert.equal(P.lockView(L), 'locked');
});

test('FEC: clean link corrects little, heavy noise produces uncorrectables', () => {
  const rnd = P.rng(7);
  const clean = P.fecTick(Array(8).fill(P.BASE_SER), P.CW_PER_TICK, rnd);
  assert.equal(clean.uncorrectable, 0);
  assert.ok(clean.corrected < P.CW_PER_TICK * 0.01);
  const noisy = Array(8).fill(P.BASE_SER);
  const s = P.noiseToSer(100);
  for (const l of P.lanesOnSerdes(P.buildLink({ width: 2, preset: 'grouped', rot: [], skewNs: skew0 }), 0)) noisy[l.pcs] += s;
  const bad = P.fecTick(noisy, P.CW_PER_TICK, rnd);
  assert.ok(bad.uncorrectable > 0, 'expected uncorrectable codewords');
  assert.ok(bad.perLane[0] > bad.perLane[7] * 100, 'errors concentrate on the noisy lanes');
  const histTotal = bad.hist.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(histTotal - P.CW_PER_TICK) <= 1);
});
