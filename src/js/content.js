/* Stage definitions: where each numbered stage sits in the scene and what the
   detail panel says about it. Sub-boxes are the standard function names. */
(function (P) {
  'use strict';

  // Sub-blocks drawn in the scene. lane: true spans the 8-lane stack.
  P.BOXES = [
    { x: [0, 4], name: 'MAC / RS', stage: 1 },
    { x: [5, 9], name: '64B/66B encode', stage: 2 },
    { x: [10.5, 14.5], name: '256B/257B transcode', stage: 2 },
    { x: [16, 19], name: 'Scramble', stage: 3 },
    { x: [20, 23], name: 'AM insertion', stage: 3 },
    { x: [24.5, 26.5], name: 'Pre-FEC distribution', stage: 3, short: 'Pre-FEC dist.' },
    { x: [27, 30.5], name: 'RS(544,514) encode', stage: 3, short: 'RS encode' },
    { x: [31, 32.5], name: 'Symbol distribution', stage: 3, lane: true, short: 'Symbol dist.' },
    { x: [44.5, 48.5], name: 'TX PMA bit-mux', stage: 5, lane: true },
    { x: [67.5, 70.5], name: 'RX PMA demux', stage: 7, lane: true },
    { x: [71.5, 73.5], name: 'Alignment lock', stage: 8, lane: true, short: 'AM lock' },
    { x: [74.5, 78.5], name: 'Deskew', stage: 8, lane: true },
    { x: [79.5, 83.5], name: 'Lane reorder', stage: 8, lane: true },
    { x: [85, 87], name: 'De-interleave', stage: 9, short: 'De-intlv' },
    { x: [87.5, 91], name: 'RS(544,514) decode', stage: 9, short: 'RS decode', fec: true },
    { x: [91.5, 93.5], name: 'Post-FEC interleave', stage: 9, short: 'Post-FEC' },
    { x: [94, 97], name: 'AM removal', stage: 9 },
    { x: [98, 101], name: 'Descramble', stage: 9 },
    { x: [102, 106], name: 'Reverse transcode', stage: 9 },
    { x: [107, 111], name: '64B/66B decode', stage: 9 },
    { x: [112, 116], name: 'RS / MAC', stage: 9 }
  ];

  P.STAGES = [
    { n: 1, side: 'TX', title: 'TX MAC and 200GMII', span: [-1, 6],
      body: '<p>The MAC builds frames. The Reconciliation Sublayer maps them onto <b>200GMII</b>, a logical interface of 64-bit data plus control per transfer. It is usually internal to the chip, so you rarely probe it directly.</p>',
      watch: 'Nothing here is per-lane. Lanes do not exist yet.' },
    { n: 2, side: 'TX', title: '64B/66B encode, then 256B/257B transcode', span: [4, 15.5],
      body: '<p>Every 8 bytes from 200GMII become one <b>66-bit block</b> (2-bit sync header plus 64-bit payload). The PCS then <b>transcodes</b> each group of four 66-bit blocks into one <b>257-bit block</b>: the four sync headers collapse into a 1-bit header plus a little control information, which frees room for FEC parity.</p><p>Transcoding is a lossless re-packing of the same data. It is not a second, independent line code; RX reverses it exactly.</p>',
      watch: 'Four thin 66b slabs in, one wide 257b slab out.' },
    { n: 3, side: 'TX', title: 'Scramble, AM insertion, RS-FEC, distribution', span: [15, 33.5],
      body: '<p>Standard order on transmit: <b>scramble</b> the 257-bit blocks, then <b>insert alignment markers</b> (one per PCS lane, added as a group, so they are not scrambled), then <b>pre-FEC distribution</b> into two streams, <b>RS(544,514) encode</b> each into codewords A and B, and finally <b>symbol distribution</b> deals 10-bit symbols round-robin onto the 8 PCS lanes.</p><p>Because AMs go in before the encoder, they are FEC-protected. Because they go in after the scrambler, the receiver can spot them in raw lane data.</p>',
      watch: 'AM blocks enter as a group, every 81,920 257-bit blocks of stream in the real 200GBASE-R PCS.' },
    { n: 4, side: 'TX', title: 'The 8 logical PCS lanes', span: [31, 45],
      body: '<p>Each PCS lane is a 26.5625 Gb/s stream of interleaved FEC symbols. Its identity is in the data: the <b>unique bytes of its alignment marker</b> name the lane number. Nothing about a wire or pin defines it.</p><p>The PCS-to-PMA service boundary here has 8 PMA lanes. On transmit, PMA lane <i>i</i> carries PCS lane <i>i</i>.</p>',
      watch: 'Each colour is one PCS lane. Taller pale plates are its alignment markers, all launched together.' },
    { n: 5, side: 'TX', title: 'PMA bit-multiplexing', span: [42, 51],
      body: '<p>The PMA interleaves PCS lanes <b>bit by bit</b> onto fewer physical lanes. With 4 SerDes lanes, two PCS lanes share each one; with 2, four share each. Every bit of a given PCS lane follows the same physical path for as long as the mapping holds.</p><p>The PMA does not look inside the data. It does not move AMs, decode FEC, or care which lane number it carries.</p>',
      watch: 'Cubes from different PCS lanes alternate on one SerDes track. See the bit scope below for the bit-level view.' },
    { n: 6, side: 'Link', title: 'Physical SerDes lanes', span: [48.5, 67.5],
      body: '<p>These are the electrical or optical lanes: AUI, backplane, cable, or the media behind a PMD. Each has its own trace length, retimer path, and CDR, so lanes arrive at different times. That difference is <b>skew</b>.</p><p>Every PCS lane on a SerDes lane sees that lane\'s skew and its noise.</p>',
      watch: 'Add skew in the fault lab and the AM plates on one physical lane fall behind.' },
    { n: 7, side: 'RX', title: 'RX PMA demultiplex', span: [65.5, 72],
      body: '<p>The RX PMA recovers the clock on each SerDes lane and splits it back into PMA lanes. It has no idea which PCS lane is which, so the bit-slot phase it starts on is arbitrary. RX PMA lane 3 may carry PCS lane 2 after one reset and PCS lane 3 after the next.</p>',
      watch: 'Lane colours leave the demux in a different order than they entered the mux.' },
    { n: 8, side: 'RX', title: 'Alignment lock, deskew, lane reorder', span: [70.5, 85],
      body: '<p>The RX PCS hunts each PMA lane for the common AM pattern. When AMs repeat at the expected spacing, that lane has <b>alignment lock</b>, and the unique bytes say which PCS lane it is. With all lanes locked, the PCS lines their AMs up in a <b>deskew</b> buffer and <b>reorders</b> the lanes to 0..7.</p><p><b>align_status</b> becomes true only when all 8 lanes are locked and deskewed. This has to happen before FEC decode, because each codeword is spread across all 8 PCS lanes.</p>',
      watch: 'Lock rings, the deskew buffer filling to absorb skew, and the crossover restoring lane order.' },
    { n: 9, side: 'RX', title: 'RX FEC, PCS decode, 200GMII and MAC', span: [84, 117],
      body: '<p>Receive mirrors transmit: <b>de-interleave</b> symbols into codewords A and B, <b>RS(544,514) decode</b> (up to 15 symbol errors per codeword corrected), <b>post-FEC interleave</b>, <b>AM removal</b>, <b>descramble</b>, <b>reverse transcode</b> to 66-bit blocks, and <b>64B/66B decode</b> onto 200GMII.</p><p>An uncorrectable codeword is not passed on silently. The PCS marks the affected blocks as errors, so the MAC sees damaged frames as FCS errors.</p>',
      watch: 'The decoder box flashes when it corrects or fails a codeword. Without align_status, nothing decodes and the MAC sees Local Fault.' }
  ];
})(globalThis.PCS = globalThis.PCS || {});
