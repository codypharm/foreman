# Foreman

**Know what you're buying before you trade a TapeOut miner.**

For any TapeOut miner, listed circuit or RIG voucher, Foreman answers three questions and publishes the answers on X Layer:

1. **Is it original?** Exact copies and wrappers, with the evidence: which earlier circuit, both design times and the shared netlist hash.
2. **What's it worth?** An estimated value range and payback, from the miner's own on-chain weight, with every input shown.
3. **What can I do with it?** Hold, Sell, Lend and Rent, each shown as it really is today.

- **Web app:** https://foreman-eight-beta.vercel.app/
- **API health:** https://api-production-7065c976.up.railway.app/health

Built for **X Layer TapeOut Accelerate** (OKX Build X).

Foreman never holds a miner, never lends, rents or trades, and never calls a circuit fake or stolen. It states what the chain shows. Values are estimates under stated assumptions. Not financial advice.

## The problem

A TapeOut miner is a circuit NFT that passed the official test vectors and earns BEM under Proof of Design on BNB Chain. Miners trade on TapeOut's circuit market, and since October 2026 they can be bridged to X Layer as RIG vouchers.

Anyone can tape out a byte-for-byte copy of someone else's circuit, or a netlist made only of REF records pointing to another circuit, and list it. Asking prices for mining miners range by four orders of magnitude for the same weight. Nothing checked existing circuits (TAPs issue #102).

## What a result says

Every result names what was checked, against how many circuits and up to which block:

| Verdict | Meaning |
| --- | --- |
| **Copy of circuit #X** | Same netlist hash as circuit #X, which has an earlier design time. Names both circuits, both design times and the hash |
| **Wrapper of circuit #X** | The netlist is only REF records. Names the circuit they point to and the one at the end of the chain that holds the gates |
| **Too small to tell** | Identical to earlier circuits, but under 4 gates, where honest circuits match by nature |
| **No earlier copy found** | No earlier circuit in the index has the same netlist hash, e.g. "among 80,409 circuits checked, up to BNB block 135,273,897" (23 Nov 2026) |
| **Can't check** | The netlist can't be read, or the circuit is outside the index |

**The rule: the earliest proven design is the original.** A circuit's design time is its design commitment block when the mining contract accepted one before its tape-out, otherwise its tape-out block. Within a block, the lower transaction index, then log index, is earlier.

**The limit:** Foreman checks identical netlists, including swapped gate inputs. A copy with its gates reordered isn't detected.

Every result also says whether the circuit can mine: mining now; can't mine (and why); stopped (and when it can start again); or not started.

## Published on X Layer

Every miner's and every listed circuit's result is written to Foreman's results contract, **ForemanResults**, on the **X Layer testnet (chain 1952)**: `0xe1b2343d3da66afec740c0fcaf40a701e2d513e8`. The source is verified on Sourcify (exact match). It isn't upgradeable, and only one publisher address can write to it.

A worker follows BNB Chain every 5 minutes and publishes a circuit again when its verdict, its evidence or its can-mine state changes. A later index block or a higher circuit count alone isn't a change.

**Re-check any result yourself:**

1. **The short verdict in storage:** call `resultOf(processor, circuitId)`. It returns the verdict kind (1 no earlier copy found, 2 copy, 3 too small to tell, 4 wrapper, 5 can't check), the can-mine state (1 mining, 2 can't mine, 3 stopped, 4 not started), the BNB block the index was read up to, and `resultHash`.
2. **The full result in the log:** the `Published` event of the publish transaction carries the result as JSON, with its evidence, rule version and block.
3. **Tie them together:** `keccak256` of the logged bytes equals the stored `resultHash`.

On any result page, **Read it back from the contract** does these three checks in your browser, straight from X Layer, not through Foreman's API.

Results are on the testnet for the hackathon. ForemanResults isn't deployed on X Layer mainnet (chain 196).

## Addresses

Every contract address Foreman reads or writes, each confirmed on chain before use:

| Chain | Contract | Address | Used for |
| --- | --- | --- | --- |
| X Layer testnet (1952) | ForemanResults | `0xe1b2343d3da66afec740c0fcaf40a701e2d513e8` | Foreman's published results |
| BNB Chain (56) | PoD mining contract (proxy) | `0x7e2e0dc66a3bd9103e69b766afa62d9f7b697b46` | Miners, weights, design commitments, claims |
| BNB Chain (56) | PoD mining logic | `0xa3dbe873da37cd4e4a13c7cef23a7db6ca60f898` | Verified source behind the proxy |
| BNB Chain (56) | BEM token | `0x5ce033b2bfca3af30b3e8c8457deaf776a8b695a` | Emission and claims |
| BNB Chain (56) | Processor factory | `0x68224f668083c29e9800be2a646d42d18cedf7e2` | Every processor, and through them every circuit's netlist and tape-out |
| BNB Chain (56) | Eligible processors | `0x1f5cb4aeae1807bf60c3b9c0d8adbcc14e91f12c` (×6), `0xb1024b89886b9a34aa4ff5f31c411d708b20a14c` (×1) | The two processors that can mine |
| BNB Chain (56) | TapeOut circuit market (proxy) | `0x6feebbebc07bcb90bd1ac8b0cf9baa4f0ff2b46f` | Listings, sales, asks |
| BNB Chain (56) | BEM/WBNB pool (PancakeSwap v3) | `0x28b12792f9d81bd529bc5572434e861c9edbbbc2` | BEM's 30-minute average price, for payback |
| BNB Chain (56) | Multicall3 | `0xca11bde05977b3631167028862be2a173976ca11` | Bundled reads at one block |
| X Layer (196) | RIG voucher | `0x9cfc959cd42b2e1d39a0d850c528210e818ae520` | Which miner a voucher stands for, and who holds it |
| X Layer (196) | TapePool account factory, pool, quote calculator (third party) | `0xa9014e27dd17ea30e4fa4f71934645b9dcef8ac8`, `0x1a9a9850d597d8e3a03afae48e3ac8e2d4aec9d7`, `0xfcc669bc9cca397cb01804035d5be981d7389ef2` | Lend offers against RIG vouchers |

## How it works

1. **Index.** Every circuit on every BNB Chain processor, from one scan of `TapedOut` events with each processor's count checked against its `nextId()`. Then each netlist and each miner's design commitment. Followed every 5 minutes.
2. **Check.** Each netlist is hashed: its input and output counts and bytes, with each NAND's two inputs put in order. Same hash and an earlier design time is a copy; only REF records is a wrapper.
3. **Value.** Expected output = miner weight ÷ verified network weight × daily emission × 99%, with halvings on schedule. Low, base and high come from network growth measured on chain over the last 30 days. Payback compares the asking price with that output at BEM's 30-minute pool average.
4. **Market.** Sell shows recent sales and asks of comparable miners, picked by a stated rule. Lend shows TapePool's live quote or why there's none. Rent shows that no rental market exists yet.
5. **Publish.** Changed results go to ForemanResults on X Layer, each with its rule version and the block it was read at.
6. **Show.** The live listings page checks every open listing. The result page shows the three answers with their evidence. **Your miners** shows a connected wallet's miners, and a copy alert when a copy of one is listed.

No verdict, value or comparison comes from a model: code decides, from chain data.

**The forecast hasn't been backtested yet.** The payout maths mirrors the mining contract and is tested; how often past ranges held is not measured yet, and the app says so ("backtest pending").

## Run it locally

Needs Node 24, pnpm 11 and Docker.

```bash
pnpm install
docker compose up -d
cp .env.example .env
```

Fill in `.env`: `BNB_ARCHIVE_RPC_URL` (a BNB Chain archive node), `BNB_ARCHIVE_LOG_BLOCKS` (logs per read; `50000` for NodeReal) and `DATABASE_URL` (the local Postgres from `docker-compose.yml`). The index is built by `pnpm --filter @foreman/index follow`; the first build reads every circuit since launch and takes a while.

```bash
pnpm --filter @foreman/api serve
```

```bash
pnpm --filter @foreman/web dev
```

The web app runs on http://localhost:5173 against the API on port 8787. `pnpm test` runs every package's tests; the database tests need `TEST_DATABASE_URL`.

## Repository

| Path | What |
| --- | --- |
| `packages/contract` | The data contract: the shared types and their parsers |
| `packages/chain-bnb` | BNB Chain reader: miners, network state and history, the circuit market |
| `packages/chain-xlayer` | X Layer reader: RIG vouchers, TapePool offers, reading a published result back |
| `packages/originality` | Netlist reader, hashing, copy and wrapper checks, the tape-out scan |
| `packages/index` | The circuit index's storage in Postgres |
| `packages/valuation` | Estimated value, payback and Sell comparables |
| `contracts` | ForemanResults (Solidity, Foundry) |
| `apps/api` | The API, the publish job and the worker |
| `apps/web` | The web app (Vite, React, wagmi) |
| `docs` | Product, data contract, decisions, research notes, mocks |

The rules behind every verdict and value are in `docs/decisions/`, each dated, and `docs/data-contract.md` defines every shape the API returns and the contract stores.

## Credits

Built by William. **Furqaan Nabi** ([@furqaannabi](https://github.com/furqaannabi)) built the data contract (`packages/contract`), the BNB Chain reader (`packages/chain-bnb`) and the archive backfill, which Foreman reuses.
