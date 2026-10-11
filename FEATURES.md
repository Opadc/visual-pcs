# Message Content Tracking Feature (Complete)

## What's New

Track a readable message ("Call me Ishmael") through the entire 200GBASE-R PCS pipeline to understand how data flows and why byte alignment breaks at the FEC layer.

## How It Works

### Three Zones

1. **TX: MAC → Pre-FEC (ASCII readable)**
   - Message shows as readable characters in each packet
   - Example: Lane 0 shows "C", "I", Lane 1 shows "a", "s", etc.
   - Demonstrates the 8-lane round-robin distribution

2. **FEC Zone: Pre-FEC → Post-FEC Interleave (10-bit symbols)**
   - Message **disappears from view** — byte alignment breaks
   - Packets show abstract 3-digit hex values (10-bit symbols)
   - Key insight: FEC breaks byte boundaries intentionally
   - Symbols from multiple bytes are interleaved across codewords A and B

3. **RX: Post-FEC Interleave → MAC (ASCII readable again)**
   - Message **reappears** after deskew and FEC decode
   - Proves data integrity through the entire pipeline
   - Same message emerges at RX MAC as was sent from TX MAC

### Per-Lane View

The message tracker panel shows:
- **Current zone** (highlighted)
- **Per-lane content**: what each of the 8 PCS lanes carries
  - Lane 0: "CI"
  - Lane 1: "as"
  - Lane 2: "lh"
  - Lane 3: "lm"
  - Lane 4: " a"
  - Lane 5: "me"
  - Lane 6: "el"
  - Lane 7: " "

### Interactive

- Change the message in the toolbar input field
- Watch the 3D packets update in real-time
- The lane tracker always shows which slice each lane carries
- Pause and step to examine specific points in the pipeline

## Teaching Value

This feature makes the PCS architecture concrete:

1. **Logical vs. Physical**: The 8 PCS lanes are abstract; they exist only because the PCS says so. Seeing a message split across all 8 simultaneously teaches that lane identity is data, not hardware.

2. **Why FEC Breaks Byte Alignment**: By hiding the message during FEC and showing hex symbols instead, newcomers understand that this is **intentional design**—symbols from different bytes are mixed across codewords so a burst error doesn't corrupt a single frame.

3. **Why All 8 Lanes Matter**: Each lane carries a slice; without even one, the message cannot be reassembled. This illustrates why a single SerDes lane failure takes the whole link down.

4. **Verification**: Seeing the same message emerge on RX proves that scrambling, FEC encoding/decoding, and alignment are all reversible—the data survives the entire pipeline intact.

## Technical Implementation

- **messageLaneSlice(lane)**: Returns the bytes assigned to a given PCS lane (round-robin, every 8th byte)
- **msgCharAt(u, slot)**: ASCII character at position u on a lane (used before/after FEC)
- **symHexAt(u)**: 10-bit symbol value as hex (used in FEC zone)
- **UI Panel**: Shows active zone, per-lane slices, and an explanation

## Files Modified

- `src/js/state.js`: Added `messageContent`, `messageLaneSlice()`, `messageBytes()`
- `src/js/packets.js`: ASCII/hex rendering logic, zone boundaries
- `src/js/ui-message.js`: Message tracker panel (new)
- `src/html/lab.html`: Message input field and tracker panel
- `src/css/lab.css`: Message input styling
- `src/css/panels.css`: Message tracker panel styling

## Next Ideas

- Allow uploading a file to transmit
- Show bit-by-bit mapping in the bit scope (which bits belong to which message bytes)
- Display error correction in action (corrupt a character, watch FEC recover it)
- Compare message state before/after scrambling
