# Following FabX in the worker

- **Date:** 26 November 2026
- **Status:** Accepted
- **Decided by:** William, four questions, each with a recommended answer and its alternatives (decisions 1 to 4). Decision 5 applies `2026-11-25-fabx-copy-check.md`, decision 6
- **Supersedes:** the `Paused`, `Unpaused` row of `2026-11-25-fabx-copy-check.md`, decision 6. That record isn't edited
- **Extends:** `2026-11-23-hosting.md` (the worker) and `2026-11-25-fabx-can-mine.md`

## Context

FabX's history is stored up to X Layer block 76,847,895, read once by hand. The FabX ADR says it is followed every 5 minutes after. Measured on 26 November 2026: X Layer's `finalized` block is about 21 minutes (1,251 blocks) behind the head, and `safe` about 2 minutes. Public nodes serve logs 100 blocks per read.

Since `2026-11-25-fabx-can-mine.md`, a FabX miner's can-mine fact comes from its stored miner record, which doesn't show whether FabX's contract is paused. What a pause does to FabX's miners is in FabX's unverified code. FabX has never paused.

## Decisions

### 1. A pause freezes FabX results

`Paused` and `Unpaused` are freezing events, beside `Upgraded`, `OwnershipTransferred` and `ProcessorSet`. Everything decision 6 of the FabX ADR says about a freeze applies to them.

*Rejected:* "Can't check" for every FabX miner while paused, back on `Unpaused` without a review. *Rejected:* keeping the stored status, which could show "Mining now" for a miner FabX has paused.

### 2. FabX reads use `XLAYER_MAINNET_RPC_URL`

The follow and the FabX scripts read X Layer mainnet through `XLAYER_MAINNET_RPC_URL` when it is set. Without it, or after it, they use the three public nodes (`rpc.xlayer.tech`, `xlayerrpc.okx.com`, `xlayer.drpc.org`) in turn. `XLAYER_RPC_URL` stays the publisher's. The follow refuses a node whose chain id isn't 196.

*Rejected:* the public nodes only, which leaves no way to switch to another node.

### 3. Followed to X Layer's finalized block

As BNB Chain's follow does. No stored tape-out, commitment or freezing event can be undone by a reorganisation. A new FabX circuit appears about 25 minutes after its tape-out.

*Rejected:* `safe`, which is faster but could store an event a reorganisation undoes.

### 4. A failed FabX follow warns, and the run carries on

Like the market and owner follows: a warning in the run, and BNB Chain's refresh and publish go ahead. `GET /health` shows FabX's last follow and whether it is frozen. It turns 503 when FabX hasn't followed in 30 minutes and isn't frozen. It never turns 503 for a freeze (FabX ADR, decision 6).

*Rejected:* never 503 for FabX, which could leave a FabX outage unnoticed. *Rejected:* failing the whole run, which would stop BNB Chain's results over FabX.

### 5. All or nothing, and nothing past a freezing event

- A follow reads everything first: the logs, new circuits' netlists, every miner record and each new unconfirmed commitment's block time, all at the block it follows to. It saves them in one transaction, or saves nothing. FabX's stored data is always one block's.
- When the logs hold a freezing event, the follow saves FabX only up to the block before it, and records the event and the freeze. FabX's results stay "read at block A, before it" (FabX ADR, decision 6).
- While frozen, the follow reads nothing for FabX. BNB Chain's results carry on against FabX's data at that block.

## Consequences

- `FREEZING` gains `Paused` and `Unpaused`.
- The worker's follow stage gains FabX, after BNB Chain's follow.
- Unfreezing stays William's: a script changes the reviewed implementation and block and clears the freeze, once the change is recorded in On-chain facts.
