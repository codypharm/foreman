# The results contract on X Layer

- **Date:** 21 November 2026
- **Status:** Accepted
- **Decided by:** William, eight questions one at a time, each with a recommended answer (every recommendation was taken)
- **Settles:** "The results contract on X Layer: its shape, tooling, and who holds the publisher key" in CLAUDE.md's "Still open" and `docs/PRODUCT.md`
- **Changes:** `PublishedResult` in `docs/data-contract.md` stops being provisional

## Context

Foreman publishes each miner's and each listed circuit's originality result on X Layer (`docs/PRODUCT.md`, step 5; the hackathon's hard requirement, never cut). Markets and lenders are meant to read results on chain, and anyone must be able to recompute a result from what is published. About 20,850 miners and the circuits listed on TapeOut's market get a result.

## Decision

1. **A short verdict in storage, the full result in the log.** Contract storage holds a short verdict per circuit, which other contracts can read. The full `Originality` goes in the event log of the same transaction, so all the evidence is on X Layer and nothing depends on Foreman's server.
   *Rejected:* the full result in storage (several times the gas, and every verdict shape encoded in Solidity); a hash only, with the result on Foreman's API (nothing readable on chain without our server).
2. **Every miner and listed circuit once, then again only on change.** The first publish covers every miner and listed circuit, in batches. After that a circuit is published again only when its verdict or its can-mine state changes, and new miners and new listings are published as they appear. A count beside a verdict (`design-shared`, "1 of 3,021 miners using this design") stays as of its block until the next publish.
   *Rejected:* on demand only (most miners would have nothing on chain for a market or lender to look up); every result on a schedule (about 20,850 results a day, nearly all unchanged).
3. **Fixed code, swappable publisher.** The contract can't be upgraded. Only one publisher address can write. An owner address, William's wallet kept apart from the publisher, can replace the publisher and do nothing else. A new rule version or shape means a new contract, listed in On-chain facts.
   *Rejected:* an upgradeable proxy (readers would have to trust that published results' meaning won't change under them); no owner at all (a leaked or lost publisher key means a new contract).
4. **A dedicated publisher wallet.** A new wallet used only for publishing, holding a little OKB for gas. William creates it and passes its key to the publish job as an environment variable when the job starts. It is never in the repo, a log or a commit, and no agent session signs with it. If it leaks, the worst case is false results until the owner replaces it, plus its small OKB balance.
   *Rejected:* William signing each batch in OKX Wallet (about 420 batches for the first publish, and every change waits); a cloud key service (an account and setup, with hosting not yet chosen).
5. **Foundry for the contract.** Build, Solidity tests, a local copy of X Layer for end-to-end checks, and a deploy script William runs with his own key. forge-std is added as a library under `contracts/`. The publish job stays TypeScript with viem, like the readers.
   *Rejected:* Hardhat (a large npm dependency tree, and anvil is still needed for local copies); solc and viem only (hand-building what Foundry gives).
6. **The short verdict:** the verdict kind, the can-mine state, the index block the result was checked up to, and the hash of the full result in the log. Looked up by processor and circuit id. A market or lender can act on the kind alone, and anyone can check that a log entry is the one that was stored.
   *Rejected:* adding the earlier circuit's processor and id (two more slots, and a wrapper with several targets still needs the log); kind and block only (nothing ties storage to its log entry).
7. **The log holds the data contract's own JSON.** The full result is the data contract's wire JSON for an `Originality` (bigints as decimal strings, as for every other shape), as bytes. One format shared with the API, decoded with the contract's own parser, readable in any block explorer. The stored hash is `keccak256` over those exact bytes.
   *Rejected:* ABI-encoded structs (every verdict and fact shape mirrored in Solidity and TypeScript, a lot of new encoding where a mistake would be invisible); compressed JSON (unreadable in an explorer).
8. **Originality only.** The estimated value is not published. It stays on screen and in the API with its inputs and model version. A value changes every day, so publishing it on change would mean republishing nearly every miner daily, and the model isn't backtested.
   *Rejected:* value on change (an untested forecast on chain under Foreman's name); a slot for value in this contract (a later contract can add it once the model is backtested).

## What follows from these

**The contract** (Solidity, in `contracts/`), in outline:

```solidity
struct Verdict {
    uint8 kind;          // 0 never published, 1 no earlier copy found, 2 copy, 3 too small to tell, 4 wrapper, 5 can't check
    uint8 canMine;       // 1 mining, 2 can't mine, 3 stopped, 4 not started
    uint64 indexBlock;   // the BNB Chain block the index was read up to
    bytes32 resultHash;  // keccak256 of the JSON in the Published event
}

function resultOf(address processor, uint256 circuitId) external view returns (Verdict memory);
function publish(Entry[] calldata entries) external;   // publisher only
function setPublisher(address next) external;          // owner only

event Published(bytes32 indexed key, address indexed processor, uint256 indexed circuitId,
                uint8 kind, uint8 canMine, uint64 indexBlock, bytes32 resultHash, bytes result);
event PublisherChanged(address indexed previous, address indexed next);
```

- **The key** is `keccak256(abi.encodePacked(processor, circuitId))`, the same as a miner key, so a miner's result is found by its miner key too. This contract holds BNB Chain circuits only (the index is BNB Chain only for the MVP, `2026-11-20-circuit-index.md`). X Layer circuits would need a new contract.
- **The contract computes the hash itself** from the bytes it is given, so the stored hash always matches the logged bytes. It can't check that the JSON says the same as `kind`, `canMine` and `indexBlock`. A reader that wants certainty parses the logged JSON and compares. The publish job's own test proves they agree.
- **What counts as a change** (decision 2): a different verdict kind, different evidence for the same kind (a copy of a different circuit, a wrapper with different targets), or a different can-mine state. A new index block, a changed count or a changed fact on its own doesn't trigger a publish.
- **What is published:** complete results with `scope` "miner" or "listed". A "Can't check" verdict that is a complete result (an unreadable netlist, a REF target outside the index) is published. A "Can't check" error (a circuit outside the index, a failed read) is not a result and is never published (`2026-11-20-complete-result-or-none.md`). `scope: "pasted"` is never published.
- **Batch size** is measured on the testnet, not guessed: as many entries per transaction as fit comfortably under X Layer's block gas limit.
- **Testnet first.** The X Layer testnet is chain id 1952 (read from `testrpc.xlayer.tech` on 21 Nov 2026). William deploys to the testnet, then to mainnet. Both addresses go into On-chain facts once confirmed. If mainnet is cut (CLAUDE.md's cut list), the demo publishes on the testnet.
- **Rule version:** each logged result carries its `ruleVersion` string spelled out (`2026-11-20-originality-result.md`, decision 2). A new rule version is a new ADR, and decision 3 makes it a new contract.

## Consequences

- **`contracts/`:** the results contract, test first in Solidity: only the publisher writes, only the owner replaces the publisher, the stored hash equals `keccak256` of the logged bytes, and a republish replaces the short verdict while the old log entry stays.
- **The publish job** (`apps/api`'s jobs): builds results from the index, finds what changed since the last publish, sends batches with the key William provides, and records what was published. Its "Published result" test (CLAUDE.md): a result written to a local copy of X Layer decodes back from the log to the same verdict, evidence, rule version and block, and its short verdict agrees.
- **`packages/contract`:** `parseOriginality` and `serialiseOriginality` don't exist yet. They are written before the publish job, and the serialiser parses its own output, like `serialiseOffer`.
- **`PublishedResult`** in the data contract gets its final shape: the published chain can be 196 or 1952.
- **Not decided here:** hosting for the job (still open), and OCCC status, which is in the result's `occc` field as "not-checked" until settled.
