# Foreman

**Know what you're buying before you trade a TapeOut miner.**

For any TapeOut miner, listed circuit or RIG voucher, Foreman answers three questions and publishes the answers on X Layer. For FabX's miners on X Layer, it answers the first one ([FabX miners on X Layer](#fabx-miners-on-x-layer)).

1. **Is it original?** Exact copies and wrappers, with the evidence: which earlier circuit, both design times and the shared netlist hash.
2. **What's it worth?** An estimated value range and payback, from the miner's own on-chain weight, with every input shown.
3. **What can I do with it?** Hold, Sell, Lend and Rent, each shown as it really is today.

| | |
| --- | --- |
| **Web app** | https://foreman-eight-beta.vercel.app/ |
| **API health** | https://api-production-7065c976.up.railway.app/health |
| **Demo video** | Link added at submission |
| **Results contract** | ForemanResults on X Layer testnet (chain 1952): `0xe1b2343d3da66afec740c0fcaf40a701e2d513e8` |

Built for **X Layer TapeOut Accelerate** (OKX Build X).

![A result page: circuit #5607 is a copy of circuit #5566, with the evidence, its estimated output and its payback](docs/screenshots/result-page.png)

Foreman never holds a miner, never lends, rents or trades, and never calls a circuit fake or stolen. It states what the chain shows. Values are estimates under stated assumptions. Not financial advice.

## The problem

A TapeOut miner is a circuit NFT that passed the official test vectors and earns BEM under Proof of Design on BNB Chain. Miners trade on TapeOut's circuit market, and since October 2026 they can be bridged to X Layer as RIG vouchers, sold there and borrowed against.

- **Copies cost nothing to make.** Anyone can tape out a byte-for-byte copy of someone else's circuit, or a netlist made only of REF records that points to another circuit, and list it. Nothing checked existing circuits (TAPs issue #102). On 25 November 2026, 89 of the 308 mining miners for sale on TapeOut's market were copies of an earlier circuit.
- **Prices are guesses.** Asking prices for mining miners ran from 0.015 to 222 BNB per unit of weight in November: sellers guess, and buyers can't tell a fair ask from a silly one.
- **Options are scattered.** Selling, borrowing and renting each live somewhere different, and some don't exist yet.

The market is small and early, and growing on X Layer: the time to put trust in place is before the money arrives.

## Who it's for

| User | What they get |
| --- | --- |
| **Buyers** | Before paying: is this listing a copy or a wrapper, what will it likely earn, and how long the asking price takes to pay back |
| **Owners** | What their miners are worth, and a copy alert when someone lists a copy of one |
| **Markets and wallets** | Originality results on X Layer that any contract or app can read, to stop listing copies and wrappers as compliant |
| **Lenders** (such as TapePool) | The same results before a loan, and a second opinion on value |

### Business model

**Free to check, pay to be watched, pay to integrate** (`docs/decisions/2026-11-26-revenue-and-reach.md`).

| Who | Free, live today | Paid, next |
| --- | --- | --- |
| Buyers | Every verdict, estimated value, payback and published result | Nothing |
| Owners | Your miners and copy alerts in the app, and copy alerts by Telegram for one address ([@ForemanCopyAlertsBot](https://t.me/ForemanCopyAlertsBot)) | **Foreman Pro:** Telegram alerts for up to 20 addresses, browser notifications, value history |
| Markets, wallets, lenders | Reading published results on X Layer, and the API with a key on request ([below](#api-for-markets-and-lenders)) | **The paid API:** billing per key, estimated values, and a webhook when a copy is listed |

Owners would keep paying because a copy of their miner can be listed at any time. Markets and lenders would pay because listing or lending against a copy costs them their users' trust, and the API is cheaper than indexing every circuit on two chains themselves. The published results stay free: they are the public record anyone can re-check. Foreman Pro and billing aren't built yet; free Telegram alerts and the API, with keys on request, are live.

### Reaching users

1. **Facts where TapeOut's users already are,** in TapeOut's community channels and on X, each with a link to check your own miner. For example, 4,982 of FabX's 7,145 miners are identical to an earlier circuit.
2. **Every result page is a link** a buyer can paste into a trade chat before a deal.
3. **Partners:** the markets and tools buyers already use, such as OwlGate, TapePool, TapeOut's circuit market and FabX, reading the published results and then the API.

## How it uses TapeOut and X Layer

- **Reads TapeOut's contracts on BNB Chain:** the Proof of Design mining contract (miners, weights, design commitments), the processor factory and every processor (each circuit's netlist and tape-out), and TapeOut's circuit market (listings and sales).
- **Reads X Layer:** RIG vouchers (which miner a voucher stands for, and who holds it), TapePool's lending quotes, and FabX: its processor in TapeOut's X Layer factory (each circuit's netlist and tape-out) and its mining contract's history (miners, design commitments, and any change to the contract).
- **Writes to X Layer:** every miner's and every listed circuit's originality result, TapeOut's and FabX's, goes to Foreman's own contract, ForemanResults, which anyone can read and check.

Every address is listed under [Addresses](#addresses), each confirmed on chain before use, and the [architecture diagram](#how-it-works) shows how the pieces connect.

## Screens

**Live listings.** Every open listing on TapeOut's market, checked: copies, wrappers and circuits too small to tell, with each one's estimated output.

![Today's listings, checked: 89 of the 308 mining miners for sale are copies of an earlier circuit](docs/screenshots/live-listings.png)

**Your miners.** Connect a wallet (OKX Wallet first) to see the miners it holds, and a copy alert whenever a circuit identical to one of them is listed.

![Your miners: copy alerts for a wallet's miners, each naming the listed copies and the earliest design](docs/screenshots/your-miners.png)

<table>
<tr>
<td width="50%" valign="top">

**Read it back from the contract.** On any result page, your browser checks the published result straight from X Layer, not through Foreman: it finds the publish transaction, checks that the contract stores that result's hash, and compares the verdict with the page.

</td>
<td width="50%" valign="top">

**On a phone.** Every page is built mobile first.

</td>
</tr>
<tr>
<td valign="top"><img src="docs/screenshots/read-back.png" alt="The Published panel after reading the result back from X Layer: found the publish, the contract stores this result, same verdict and evidence as this page" width="340"></td>
<td valign="top"><img src="docs/screenshots/result-page-mobile.png" alt="Circuit #5607's result page on a phone" width="300"></td>
</tr>
</table>

## What a result says

Every result names what was checked, against how many circuits and up to which block:

| Verdict | Meaning |
| --- | --- |
| **Copy of circuit #X** | Same netlist hash as circuit #X, which has an earlier design time. Names both circuits, both design times and the hash |
| **Wrapper of circuit #X** | The netlist is only REF records. Names the circuit they point to and the one at the end of the chain that holds the gates |
| **Too small to tell** | Identical to earlier circuits, but under 4 gates, where honest circuits match by nature: 7,520 miners of 1 to 3 gates share just 53 designs |
| **No earlier copy found** | No earlier circuit in the index has the same netlist hash, e.g. "among 80,455 circuits checked, up to BNB block 135,643,755" (25 Nov 2026) |
| **Can't check** | The netlist can't be read, or the circuit is outside the index |

**The rule: the earliest proven design is the original.** A circuit's design time is its design commitment block when the mining contract accepted one before its tape-out, otherwise its tape-out block. Within a block, the lower transaction index, then log index, is earlier. So a tape-out can't be front-run.

**The limit:** Foreman checks identical netlists, including swapped gate inputs. A copy with its gates reordered isn't detected.

Every result also says whether the circuit can mine: mining now; can't mine (and why); stopped (and when it can start again); or not started.

## FabX miners on X Layer

FabX is a mining system on X Layer that mines FAB with circuits from TapeOut's X Layer factory. It's separate from TapeOut's BEM mining, and its contracts are controlled by their own owner. Foreman shows it as **FabX · X Layer**.

Foreman checks every FabX miner for copies, with the same netlist hash and the same rule as on BNB Chain:

- **Against both chains.** Each FabX miner is compared with every circuit on BNB Chain and every circuit on FabX's processor, and BNB Chain results are compared with FabX's circuits too. Across chains, design times are compared in seconds, each its own block's timestamp. Two circuits designed in the same second on different chains can't be ordered, so neither is called a copy of the other.
- **Only facts FabX's owner can't edit.** Netlists and tape-outs come from the processor, which runs TapeOut's shared processor code. A FabX design commitment counts only when its `DesignCommitted` event is found in the block it names. Where a commitment without its event would decide the order, the result is **Can't check**.
- **No value.** Foreman doesn't read FAB's price or FabX's output, so a FabX result page says "Value: not covered yet", and Sell, Lend and Rent say why there's nothing to show.

**What it found.** Of FabX's 7,145 miners, checked against 87,606 circuits up to BNB block 135,430,423 and X Layer block 76,900,680 (26 Nov 2026):

| Verdict | FabX miners |
| --- | --- |
| **Copy of an earlier circuit** | 4,982, sharing 256 designs. 625 of them copy a circuit on BNB Chain; 4,673 were taped out by a different address than the earlier circuit |
| **Too small to tell** (under 4 gates) | 876 |
| **No earlier copy found** | 1,253 |
| **Can't check** (a design commitment without its event would decide the order) | 34 |

For example, FabX #24 is byte-identical to circuit #97 on BNB Chain (processor ×1), which taped out 57 days earlier, at BNB block 116,187,134. Both have netlist hash `0xb546f5b9789f61b5a9a497a5545356df53317cf36919a934925411ffdf19184c`.

<img src="docs/screenshots/fabx-result-mobile.png" alt="FabX #24's result page on a phone: the FabX · X Layer mining contract panel with its fact line and caveat, Copy of circuit #97 on BNB Chain with both tape-outs and the shared netlist hash, and Value: not covered yet" width="300">

**The guard.** FabX's mining contract can be upgraded by its owner, a single wallet, and its source isn't verified. Every FabX result says so: "FabX's owner can change its mining contract. Read at X Layer block B; Foreman stops FabX results if it does." The worker follows FabX every 5 minutes. An `Upgraded`, `OwnershipTransferred` or `ProcessorSet` event freezes FabX results and their publishing until the change is reviewed; BNB Chain results carry on.

**Published** to the same ForemanResults contract. A FabX result is told apart by its processor (`0x87bfca3494aa228ff589ab9b642143a5e8c8f9a6`), by the chain and mining contract named in its full result, and by its rule version: "hash 2026-11-20, floor 4, chain 10, BNB Chain and X Layer by second, FabX commitments by event". FabX #24 was published in transaction `0x47763a08ab50a15bb70c2b64eea5b7cd09407a10f2486df9434d8e8c0e2764d7` at X Layer testnet block 47,230,946.

## Published on X Layer

Every miner's and every listed circuit's result is written to Foreman's results contract, **ForemanResults**, on the **X Layer testnet (chain 1952)**: `0xe1b2343d3da66afec740c0fcaf40a701e2d513e8`. The source is verified on Sourcify (exact match). It isn't upgradeable, and only one publisher address can write to it.

A worker follows BNB Chain and FabX every 5 minutes and publishes a circuit again when its verdict, its evidence or its can-mine state changes. A later index block or a higher circuit count alone isn't a change.

**Re-check any result yourself:**

1. **The short verdict in storage:** call `resultOf(processor, circuitId)`. It returns the verdict kind (1 no earlier copy found, 2 copy, 3 too small to tell, 4 wrapper, 5 can't check), the can-mine state (1 mining, 2 can't mine, 3 stopped, 4 not started), the BNB block the index was read up to, and `resultHash`.
2. **The full result in the log:** the `Published` event of the publish transaction carries the result as JSON, with its evidence, rule version and block.
3. **Tie them together:** `keccak256` of the logged bytes equals the stored `resultHash`.
4. **Redo the verdict from BNB Chain:** the result names both circuits, both design blocks and the netlist hash. Read both netlists from the processor (`netlist(id)`), hash them by the rule above, and compare the blocks.

For example, circuit #5607 on processor `0xb1024b89886b9a34aa4ff5f31c411d708b20a14c` was published in transaction `0x466062da96b3c80a44494f8bf54c2129a6501074162e65d20d0a31414cc23624` at X Layer testnet block 46,801,755: copy of circuit #5566, which taped out at BNB block 117,798,950, before #5607's design commitment at block 117,802,215.

Results are on the testnet for the hackathon. ForemanResults isn't deployed on X Layer mainnet (chain 196).

## API for markets and lenders

One call checks up to 100 circuits, for example every circuit about to be listed (`docs/decisions/2026-11-26-api-keys.md`). Each answer is the circuit's result with its evidence, rule version and block, and the X Layer transaction where it was published, so it can be re-checked on chain. A circuit that isn't a miner or listed is checked on request and isn't published. One Foreman can't check says why, never a verdict. Estimated values stay on the result page.

```bash
curl -X POST https://api-production-7065c976.up.railway.app/v1/results \
  -H "Authorization: Bearer $FOREMAN_KEY" -H "Content-Type: application/json" \
  -d '{"circuits": [{"chainId": 56, "processor": "0xb1024b89886b9a34aa4ff5f31c411d708b20a14c", "tokenId": "8044"}]}'
```

```jsonc
{ "results": [{
  "circuit": { "chainId": 56, "processor": "0xb102…a14c", "tokenId": "8044" },
  "check": { "state": "checked", "originality": { "result": { "verdict": "copy", … }, "facts": […], "index": {…}, "ruleVersion": "…" } },
  "published": { "state": "older", "verdict": "same", "publishedAt": { "chainId": 1952, "block": "…", "tx": "0x…" }, … }
}] }
```

Keys are issued by hand: ask for one. Each key may make 60 calls a minute; more is HTTP 429 with `Retry-After`. A missing or revoked key is HTTP 401. The call is server to server only, so a key can't be used from a web page. The shapes are in `docs/data-contract.md`, "API responses".

## The forecast backtest

The payout maths mirrors the mining contract and is tested. The forecast, the low / base / high range of network growth, is backtested against what happened:

- **Test:** for every past start date with 30 days of history before it and 30 days after, the 30-day range the app would have shown that day, against what a verified miner of unchanged weight actually earned on the real network.
- **Result (model 2026-11-24, start dates 21 Sep to 25 Oct 2026):** the range held in **35 of 35** start dates. Base was below what miners earned every time: by 7.1% typically and 41.0% at worst, rounded up (the worst on 21 Sep, just after the network stopped growing fast).
- **Read it with care:** neighbouring start dates share most of their 30 days, so 35 start dates aren't 35 independent tests. The high case's rule, no network growth, was chosen after the earlier rule (the slowest week) held in only 13 of 34, on this same history. It would miss if the network shrank, which it hasn't so far.
- **Not tested:** the "until the 2030 halving" view, about 1,365 days, which 95 days of history can't test, and the low case's loss of the design bonus. The app says so.

Rerun it from the saved samples: `pnpm --filter @foreman/valuation backtest`. The rules are in `docs/decisions/2026-11-24-forecast-backtest.md` and `2026-11-24-high-case-no-growth.md`.

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
| X Layer (196) | TapeOut processor factory (proxy) | `0x1f09daefa827f02cbb40967cc91b259763760761` | X Layer's processors, FabX's among them |
| X Layer (196) | Processor beacon | `0xf70d1ed4f62cf3780157b0b421b7e2f45bd0991c` | The shared processor code; no owner can change a netlist |
| X Layer (196) | FabX processor (third party) | `0x87bfca3494aa228ff589ab9b642143a5e8c8f9a6` | FabX's circuits: netlists and tape-outs |
| X Layer (196) | FabX mining contract (third party, upgradeable, source not verified) | `0x4f6a2312d80753bdafd35ddb1bf4bb14c43f8265` | FabX's miners, design commitments, and changes to the contract |
| X Layer (196) | Multicall3 | `0xca11bde05977b3631167028862be2a173976ca11` | Bundled reads at one block |

## How it works

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/diagrams/architecture-dark.svg">
  <img src="docs/diagrams/architecture-light.svg" alt="Foreman's architecture: a worker on Railway indexes TapeOut's contracts on BNB Chain and FabX's processor and mining contract on X Layer every 5 minutes into Postgres and publishes changed results to ForemanResults on the X Layer testnet. The API reads the index, and reads BNB Chain and X Layer live for each page. The web app shows the results and reads published results back from X Layer in the browser." width="100%">
</picture>

1. **Index.** Every circuit on every BNB Chain processor, from one scan of `TapedOut` events with each processor's count checked against its `nextId()`. Then each netlist and each miner's design commitment. Followed every 5 minutes.
2. **Check.** Each netlist is hashed: its input and output counts and bytes, with each NAND's two inputs put in order. Same hash and an earlier design time is a copy; only REF records is a wrapper.
3. **Value.** Expected output = miner weight ÷ verified network weight × daily emission × 99%, with halvings on schedule. Low assumes the fastest week of network growth in the last 30 days, base the growth over those 30 days, high no network growth. Payback compares the asking price with that output at BEM's 30-minute pool average.
4. **Market.** Sell shows recent sales and asks of comparable miners, picked by a stated rule. Lend shows TapePool's live quote or why there's none. Rent shows that no rental market exists yet.
5. **Publish.** Changed results go to ForemanResults on X Layer, each with its rule version and the block it was read at.
6. **Show.** The live listings page checks every open listing. The result page shows the three answers with their evidence. **Your miners** shows a connected wallet's miners, and a copy alert when a copy of one is listed.

No verdict, value or comparison comes from a model: code decides, from chain data.

**Stack:** TypeScript throughout. viem for both chains; Postgres with plain SQL; a Hono API and a pg-boss worker on Railway; a Vite and React web app with wagmi on Vercel; the results contract in Solidity with Foundry. An uptime monitor watches `/health`, which also warns when the publisher wallet runs low on OKB.

## Limits today

- **Results are on the X Layer testnet**, not mainnet.
- **BNB Chain circuits and FabX's.** The other 449 processors in TapeOut's X Layer factory aren't indexed.
- **FabX isn't valued**, and FabX's market isn't read. FabX results stop if FabX changes its mining contract, until the change is reviewed.
- **Reordered gates aren't detected.** Only identical netlists, including swapped gate inputs, count as copies.
- **Copy alerts come in the app and by Telegram,** one followed address per chat. Browser notifications aren't built, and Foreman Pro, which raises the limit, isn't either.
- **API keys are issued by hand,** with no billing, values or webhook yet.
- **Your miners shows TapeOut miners and RIG vouchers only.** A FabX miner's result is reached through the Check box ("FabX 1234") or its result page.

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
| `packages/chain-xlayer` | X Layer reader: RIG vouchers, TapePool offers, FabX's logs and miners, reading a published result back |
| `packages/originality` | Netlist reader, hashing, copy and wrapper checks, the tape-out scan |
| `packages/index` | The circuit index's storage in Postgres |
| `packages/valuation` | Estimated value, payback, Sell comparables and the forecast backtest |
| `contracts` | ForemanResults (Solidity, Foundry) |
| `apps/api` | The API, the publish job and the worker |
| `apps/web` | The web app (Vite, React, wagmi) |
| `docs` | Product, data contract, decisions, research notes, mocks, screenshots |

The rules behind every verdict and value are in `docs/decisions/`, each dated, and `docs/data-contract.md` defines every shape the API returns and the contract stores.

## Credits

Built by William. **Furqaan Nabi** ([@furqaannabi](https://github.com/furqaannabi)) built the data contract (`packages/contract`), the BNB Chain reader (`packages/chain-bnb`) and the archive backfill, which Foreman reuses.

## License

MIT, see [`LICENSE`](LICENSE).
