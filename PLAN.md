# Message Content Tracking Through the PCS Pipeline

## Goal
Track a readable message ("Call me Ishmael") through the TX/RX pipeline to teach how data flows and why ASCII alignment breaks at the FEC layer.

## Design

### Message String
- Default: "Call me Ishmael" (14 bytes, iconic)
- User-selectable via a text input
- Repeats to fill the frame if shorter

### TX Rendering Stages
1. **MAC/MII → 64B/66B:** Show ASCII characters (8-bit) in packet blocks
   - Message: "C a l l   m e   I s m a e l"
   - Still byte-aligned

2. **64B/66B → 256B/257B:** Show ASCII characters within transcoded blocks
   - Message visible but packed differently
   - Still byte-aligned within the 257-bit payload

3. **Scramble:** Color shift (e.g., tint blue) but message still readable on hover or under color
   - Message: still visible but marked as scrambled

4. **AM Insertion → Pre-FEC Distribution:** Color change back to normal
   - Message visible until distribution

5. **Pre-FEC Distributor:** Switch to hex or abstract 10-bit symbols
   - **Message is no longer readable** because bits are split across codewords
   - Show "10-bit symbol" labels or hex values instead
   - This is the key insight: FEC breaks byte alignment

6. **RS(544,514) Encode:** Add parity blocks (hatched/darkened)
   - Still showing hex/abstract, plus checksum blocks

### RX Rendering Stages
1. **RS(544,514) Decode:** Keep showing hex/abstract
   - FEC corrects errors but still 10-bit symbols

2. **Post-FEC Interleave:** Transition back to byte alignment
   - Re-assemble 10-bit symbols into 257-bit blocks
   - **Message becomes readable again**

3. **Reverse Transcode → 64B/66B Decode → RX MAC:** Show ASCII
   - Message: "C a l l   m e   I s m a e l" (recovered, unchanged)
   - Highlight to show integrity through the whole pipeline

### Per-Lane Distribution
- Round-robin byte assignment: lane `i` gets bytes `i, i+8, i+16, …`
- Each lane shows its slice: lane 0 gets "Csae", lane 1 gets "alm ", etc.
- On RX after reorder, reassemble into the original message

### UI Changes
- Message input field in the toolbar
- Toggle: "Show ASCII / Show hex" above the viewport (or auto-switch per stage)
- On-hover or click a packet: reveal full content at that stage
- Status line: "Message: Call me Ishmael (14 bytes, 2 frames)"

### Implementation Plan
1. Add `messageContent` and `messageInput` to state
2. Extend `packets.js` to render ASCII glyphs (2–4 chars) per cube
3. Add helper in `state.js` to compute per-lane message slices
4. Update `ui-controls.js` to add message input
5. Modify stage rendering logic to switch between ASCII and hex at Pre-FEC boundary
6. Add detail panel to show full byte at each stage on click
7. Test with "Call me Ishmael", "It was the best of times", etc.

### Testing
- Message survives TX → RX intact
- Per-lane slices are correct
- ASCII visibility switches at Pre-FEC / Post-FEC boundaries
- Hover/click reveals hex or full content
- Works at different lane widths and mappings

---
**Commit strategy:** 
- `feat: add message input and state tracking`
- `feat: render ASCII in TX packets before FEC`
- `feat: hide message in Pre-FEC, show hex symbols`
- `feat: render ASCII in RX packets after Post-FEC interleave`
- `feat: add message detail panel with per-stage content`
