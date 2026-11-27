# The Check box accepts TapeOut's circuit label

- **Date:** 27 November 2026
- **Status:** Accepted
- **Decided by:** William
- **Builds on:** `2026-11-22-check-box-input.md`, decision 1 (what the Check box accepts)

## Context

TapeOut's circuit market at `tapeout.net` labels each circuit with two numbers, such as `13931.30`:

- the first is the circuit's id;
- the second is its processor's place in TapeOut's BNB Chain processor factory.

That label is all a buyer sees there: the market shows no listing number and no processor address. On 27 Nov 2026, `cpuAt(30)` on the factory `0x6822…e7f2` returned `0xb102…a14c`, the TapeOut processor, and the market's row for `13931.30` showed listing 28111's ask, 2.36 BNB. Until now the Check box refused the label, so a buyer couldn't paste what TapeOut shows them.

## Decision

William said yes on 27 Nov 2026.

1. **A circuit id, a dot and a processor place is TapeOut's label.**
   - Accepted: `13931.30`, `2.5` and `12.0`. Place 0 is a processor.
   - Refused: no leading zeros in either number, and no other characters.
   - A number with a dot was "Not recognised" before; it is now a label.
2. **The place is read on chain when it's asked.**
   - `cpuCount` and `cpuAt` are read at BNB Chain's latest block.
   - The index doesn't store places, so there's no migration.
   - A place past the count is "No processor #N in TapeOut's BNB Chain factory, which had C at BNB block B".
   - A read that fails is a failed read, never "no such processor".
3. **BNB Chain only.** TapeOut's site also has an X Layer view, with its own factory and places.
   - The label carries no chain, and every BEM miner is on BNB Chain, so a label is read against the BNB Chain factory.
   - A label copied from the X Layer view opens a different circuit. The result page names the processor and chain, so the difference is visible, not hidden.
   - FabX circuits keep their own form, `FabX 24`.

## What follows

- `packages/chain-bnb`: `readProcessorAt`, tested on saved responses.
- `apps/api`: the Check box's resolver, which also lists the label among the accepted forms.
