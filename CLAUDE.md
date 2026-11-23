# Foreman

## Authority

**Human is architect. Agent is senior engineer.**

- **William is the lead and the only builder** (since 20 November 2026, `docs/decisions/2026-11-20-scope-and-team.md`). He owns the scope, the data contract, the trust rules and every decision. Furqaan built `packages/contract`, `packages/chain-bnb` and the archive backfill before he left; that code is reused and credited to him in the README.
- **The data contract is the one signed artifact.** It lives in `docs/data-contract.md` with types and parsers in `packages/contract`. Code against it; never widen it quietly. A field the code needs that the contract doesn't have is a proposal to William, not a local addition.
- **No spec ceremony.** This is a hackathon. `docs/PRODUCT.md` is the plan; its build order table is the order.
- **Grill before building against an unsettled requirement.** Invoke the `grill-me` skill: questions one at a time, each with a recommended answer. The queue is "Still open" at the end of this file. Not before every feature; before every guess. A grilling that settles something product-level becomes a dated ADR in `docs/decisions/`, and the item is struck from "Still open".
- **Before debugging, invoke the `diagnose` skill.** Build the fixture-based feedback loop first (a handful of real circuits including a known copy and a known wrapper, saved RPC responses, seconds to run) before theorising about a wrong verdict, a netlist that won't decode or a value that looks off.
- **Tests where wrongness is invisible** (see "Tests that are not optional"). Everywhere else, working code and a manual check are enough.
- Never make architecture decisions autonomously. Present 2–3 options with trade-offs; William chooses. Record a real decision as a dated ADR in `docs/decisions/` (`YYYY-MM-DD-title.md`). Never edit a record after the fact; write a new one that supersedes it.
- Never bulk-generate code. One reader, one check, one endpoint, one contract function at a time.
- **Before writing more than one document, show the list of files and what each will contain, and wait for a yes.**
- **Every commit and every push needs its own explicit ask.** "Commit and push" once does not carry forward.
- If stuck or ambiguous: ask. Never guess on product behaviour.
- Flag risks immediately: a verdict that could be wrong in a way nobody would notice, a value without its inputs, a key or seed phrase anywhere near the repo, a mainnet transaction from a dev session, and anything that could call an honest circuit a copy. **Being right about originality is the product.**

### Skills

`grill-me`, `diagnose` and `tdd` are used the same way as in SiteProof. **They are not in this repo yet:** copy them into `.claude/skills/` from the SiteProof repo before relying on them.

| Skill | When |
| --- | --- |
| `grill-me` | Before building against a requirement that is not settled. One question at a time, each with a recommended answer |
| `diagnose` | Before debugging. Feedback loop first |
| `tdd` | For the critical paths in "Tests that are not optional", with its approval-before-code planning phase waived |
| `impeccable` | For every frontend page and component: layout, typography, colour and polish. Not in this repo yet: add it to `.claude/skills/` before frontend work starts |

### Frontend: mock first, William chooses

- **Every page is mocked before it is built.** Use the `impeccable` skill to produce the mock: a static page with realistic sample data, no wiring to the API or the chain.
- **Show options, not one answer.** Mock 2–3 directions for each new page and present them side by side.
- **William chooses.** No page is built until William has picked a mock (or asked for changes and approved the revision). Record the chosen mock in `docs/mocks/` with the date. The mocks from 18 November were for the old scope; they are reference only.
- **Build to the chosen mock.** A change to layout or flow after the choice is a new mock and a new choice, not an edit made while building.

---

## Project

**Foreman: know what you're buying before you trade a TapeOut miner.** For any miner or RIG voucher, Foreman answers three questions and publishes the answers on X Layer:

1. **Is it original?** Exact copies (identical netlist, counting swapped gate inputs as the same; the earliest proven design is the original) and wrappers (netlists made only of REF records, with the circuit they point to), per TAPs issue #102. OCCC status where a circuit is in an OCCC collection.
2. **What's it worth?** An estimated value range and payback, from chain data.
3. **What can I do with it?** Hold, Sell, Lend and Rent, each shown as it really is today.

A TapeOut miner is a circuit NFT that passed the official test vectors and earns BEM under Proof of Design. Mining runs on BNB Chain; miners trade on TapeOut's circuit market there, and since October they can be bridged to X Layer as RIG vouchers.

**What Foreman is not:** it never holds a miner, never lends, rents or trades, and never calls anything fake or stolen. It states what the chain shows.

**Positioning, in the UI and in the README:** originality results say exactly what was checked and against how many circuits. Values are estimates, shown as ranges with their inputs. Not financial advice. Never overstate either.

Built for **X Layer TapeOut Accelerate** (OKX Build X series). Judged on user value and commercial potential, innovation, ecosystem integration, product readiness and a demo video of three minutes or less. Hard requirement: use TapeOut circuits, contracts or X Layer on-chain data, or run on DeWEB, and give the addresses.

| Milestone | When |
| --- | --- |
| Scope and team decision | 20 November 2026 |
| Feature freeze | 5 December 2026 |
| Submit | 6 December 2026; deadline 7 December 2026, 23:59 UTC, provisional |

### Key docs

| Doc | Path | Purpose |
| --- | --- | --- |
| Product | `docs/PRODUCT.md` | The problem, users, the three answers, MVP scope, build order, demo story. Source of truth |
| Data contract | `docs/data-contract.md` | Shared shapes, types and parsers in `packages/contract` |
| Decisions | `docs/decisions/` | Dated ADRs, never edited after the fact. Start with `2026-11-20-scope-and-team.md` |
| Notes | `docs/notes/` | Research behind the decisions: the mining contract, the X Layer and BNB markets |
| Brief | [Google Doc](https://docs.google.com/document/d/1PA3ftj2tFWzcKyj02hxZelqzRayx-DF3gd0w3vSYUjM/edit) | The original autopilot brief, now historical |

---

## Trust rules (locked)

| Rule | Detail |
| --- | --- |
| **Say only what was checked** | "No earlier copy found among 41,203 circuits checked, up to block 134,600,000", never "original" or "authentic" on its own. A circuit outside the index is "can't check", never "original" |
| **Every verdict carries its evidence** | A copy names the earlier circuit, both design times (tape-out or design commitment block) and the shared netlist hash. A wrapper names the circuit its REF records point to. Anyone can re-check it from chain data |
| **The earliest proven design is the original** | Stated on screen as the rule. A circuit's design time is its design commitment block when the mining contract accepted one before its tape-out, otherwise its tape-out block. Same block: the lower tape-out (transaction index, then log index) is earlier. Reworded 20 Nov 2026 from "the earliest tape-out", because tape-outs can be front-run (`docs/decisions/2026-11-20-verdict-scope-and-earliest-design.md`) |
| **Facts, never accusations** | "Byte-identical to circuit #X, taped out 3 days earlier", never "fake", "stolen" or "scam" |
| **Code decides, never a model** | No verdict, value or comparison comes from a model call. A model may write explanatory text only, from the fixed result |
| **No invented copy discount** | A miner's value comes from its own on-chain weight, copy or not. Originality is shown beside the value, never folded into it as a guessed percentage |
| **No chain data, no number** | Every value shows its inputs (miner weight, network weight, emission, pool split, block number) and the model version |
| **Ranges, not prices** | A value is always low / base / high under stated assumptions. Never a single "price" |
| **Missing is missing** | A missing offer, venue or result is shown as missing, never as zero |
| **Published results are reproducible** | Each result written to X Layer carries the rule version and the block it was read at, so anyone can recompute it |
| **Unconfirmed addresses are never used** | A contract address is used only after it is confirmed on chain and listed in "On-chain facts" with the date |

## On-chain facts

Only facts confirmed on chain or on an official TapeOut page go here, each with its date. Everything else is in "Unconfirmed".

| Fact | Value | Confirmed |
| --- | --- | --- |
| Mining chain | BNB Smart Chain (chain id 56) | 18 Nov 2026 |
| BEM token (BNB Chain) | `0x5ce033b2bfca3af30b3e8c8457deaf776a8b695a`, 8 decimals | 18 Nov 2026, script run |
| PoD mining contract (BNB Chain) | `0x7e2e0dc66a3bd9103e69b766afa62d9f7b697b46` (ERC-1967 proxy) | 18 Nov 2026, script run: every BEM mint came from a call to it |
| PoD mining logic contract (BNB Chain) | `0xa3dbe873da37cd4e4a13c7cef23a7db6ca60f898`, behind the proxy; `src/PodMining.sol` verified on Sourcify (full match) | 18 Nov 2026, proxy implementation slot and Sourcify |
| Mining contract sealed | `isSealed = true`, owner renounced, not paused: no upgrades and nobody can pause | 18 Nov 2026, storage read at block 134,351,215 |
| Per-miner claim event | `Claimed(bytes32 indexed key, address indexed to, uint256 amount)`; topic0 `0x0508a8b4117d9a7b3d8f5895f6413e61b4f9a2df35afbfb41e78d0ecfff1843f`; topic1 = miner key (bytes32); topic2 = owner wallet; data = amount (8 decimals, equals the BEM minted). One event per miner, even when one transaction claims many | 18 Nov 2026, script run; name and topic0 from the verified source, 19 Nov 2026 |
| Batch claim function | selector `0x7ed51748` (name unconfirmed) | 18 Nov 2026, script run |
| Emission | 8,333,333 base units a second (7,199.999712 BEM a day) in era 0; 99% to the verified pool, 1% to unverified. Halves every 126,000,000 s from 21 Aug 2026 13:15:32 UTC; first halving 18 Aug 2030 21:15:32 UTC | 18 Nov 2026, verified source and storage read |
| Mining eligibility | `start` reverts `Nref` if the netlist has any REF record, and `Cpu` if the processor's `processorMultiplier` is 0. Weight H = (b* + design bonus) × multiplier, b* = own burned NANDs + 6 × own burned LATCHes. One design bonus per task per processor: lowest design cost, then the earlier valid design commitment, then the lower circuit id. A copy keeps mining without the bonus | 20 Nov 2026, verified source (`docs/notes/2026-11-20-what-can-mine.md`) |
| Design commitment | `commitDesign(address circuits, bytes32 commitment)`, commitment = `keccak256(abi.encode(designer, circuits, keccak256(netlist), salt))`; event `DesignCommitted(bytes32 indexed commitment, address indexed designer, address indexed circuits, uint256 blockNumber, uint64 firstUnusedId)`. `start` checks the salt and stores the block in the miner's `commitBlock` (`getMiner`) | 20 Nov 2026, verified source |
| Eligible processors (BNB Chain) | `0x1f5cb4aeae1807bf60c3b9c0d8adbcc14e91f12c` multiplier 6; `0xb1024b89886b9a34aa4ff5f31c411d708b20a14c` multiplier 1. Every other processor has multiplier 0, and the sealed contract can't add any | 20 Nov 2026, `ProcessorSet` events since the proxy's creation at block 117,234,441 and `processorMultiplier` reads |
| Processor factory (BNB Chain) | `0x68224f668083c29e9800be2a646d42d18cedf7e2`, UUPS proxy, owner `0xb3d8…3138` (TapeOut's owner), not sealed. `cpuCount()` (1,496 on 20 Nov), `cpuAt(i)`. Processors are beacon proxies; each stores its netlists (`netlist(id)`, `circuitInfo(id)`) and emits `TapedOut(uint256 indexed id, address indexed owner, uint32, uint32)` | 20 Nov 2026, eth_call and logs (`docs/notes/2026-11-20-netlist-storage.md`) |
| RIG voucher (X Layer) | `0x9cfc959cd42b2e1d39a0d850c528210e818ae520`, ERC-721 "TapeOut Rig" (RIG), UUPS proxy upgradeable by TapeOut. One voucher = one miner held in the BNB rig vault; its BEM goes to the voucher holder. No protocol rental (removed in v2) | 19 Nov 2026: verified source; three live vouchers matched to active PodMining miners whose NFTs the vault holds (`docs/notes/2026-11-19-xlayer-market-findings.md`) |
| Rig vault (BNB Chain) | `0x48d43345656f0f9510dc3c06cba99dff597617c2`; `voucher()` = the RIG address | 19 Nov 2026, eth_call |
| Rig vault cells (BNB Chain) | The vault (implementation `RigVault` `0xeb3f0614e37d995a96fa41908de8d47a57f56463`) keeps each miner's NFT in its own cell, a minimal-proxy clone of `RigCell` at `cellOf(key)` (CREATE2 from the miner key); only the vault can move the NFT or BEM out. Cell template `cellImpl` = `0x126add4cb19aa055e2ccebba72ebde5927195ee8`, fixed (the vault's first CREATE; `cellOf` reverts otherwise). So a vouchered miner's `ownerOf` is its cell, and who holds it is the voucher holder on X Layer | 22 Nov 2026: Sourcify exact match of `RigVault`; implementation slot and `cellImpl` read; all 16 live vouchers' miner NFTs held by exactly `cellOf(key)` at BNB block 135,080,880 (`docs/notes/2026-11-22-rig-vault-cells.md`) |
| BEM (X Layer) | `0x60e62efa9405d6873c5deabd4e6cc91c25363952`, 8 decimals, LayerZero OFT; the RIG voucher's `bem()` | 19 Nov 2026, eth_call |
| TapeOut circuit market (BNB Chain) | `0x6feebbebc07bcb90bd1ac8b0cf9baa4f0ff2b46f`, proxy, owner `0xb3d85b42a045c1a88d800cad0f55d2566a4d3138` (TapeOut's owner, as for the processor factory and RIG); source not verified. Listings only, no bids; priced in BNB. `Listed(uint256 id, address, address, uint256, uint256)`; `Sold(uint256 id, address buyer, address processor, uint256 tokenId, uint256 sellerProceeds, uint256 fee)`, where proceeds + fee = the BNB the buyer paid (fee 1%); `PriceChanged(uint256, uint256)` | 19 Nov 2026: event names and types from topic hashes; amounts matched to three sales' transaction values (`docs/notes/2026-11-19-xlayer-market-findings.md`) |
| Circuit market events (BNB Chain) | Every event from `0x6feebbebc07bcb90bd1ac8b0cf9baa4f0ff2b46f`, indexed fields in topics: `Listed(uint256 indexed id, address indexed seller, address indexed processor, uint256 tokenId, uint256 price)`; `PriceChanged(uint256 indexed id, uint256 price)`; `Delisted(uint256 indexed id, address indexed, bool)` (topic0 `0xd42ab404…fa9882`; the address and bool not interpreted); `Sold(uint256 indexed id, address indexed buyer, address indexed processor, uint256 tokenId, uint256 sellerProceeds, uint256 fee)`; `Withdrawn(address indexed, uint256)` (the owner's `withdraw()`, fees). Admin: `Initialized(uint64)`, `OwnershipTransferred(address indexed, address indexed)`, `Upgraded(address indexed implementation)`. `nextListingId` was 28,111 at block 134,713,299 | 20 Nov 2026: every log from the market's first block (116,708,167, found by `eth_getCode`) to 134,720,910 has one of these eight topic hashes (28,112 Listed, 7,238 PriceChanged, 13,372 Delisted, 8,564 Sold, 21 Withdrawn, 1 Initialized, 2 OwnershipTransferred, 2 Upgraded) (`docs/decisions/2026-11-20-market-index.md`, `2026-11-20-market-admin-events.md`) |
| Circuit market code (BNB Chain) | Implementation `0x725771c38361abef7b844729b978c775f7a83dfb` (ERC-1967 slot), since block 116,709,020; the only earlier one, `0x437d0a6141079554bbaf0d507ac3070c06576647`, ran for its first 853 blocks, before any listing. Owner moved from `0x571d447f4f24688ec35ccf07f1d6993655f6af15` to `0xb3d85b42a045c1a88d800cad0f55d2566a4d3138` at block 124,343,347. A different implementation stops the market follow | 20 Nov 2026: `Upgraded` and `OwnershipTransferred` events; implementation slot read at blocks 116,709,020 and 134,720,910 (`docs/decisions/2026-11-20-market-admin-events.md`) |
| BEM/WBNB pool (BNB Chain) | `0x28b12792f9d81bd529bc5572434e861c9edbbbc2`, PancakeSwap v3, 1% fee; token0 BEM, token1 WBNB `0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c` (18 decimals); factory `0x0bfbcf9fa4f9c56b0f40a671ad40e0805a091865`; not a proxy. Keeps 2,100 observations; held 4,742 BEM and 17.8 WBNB. Payback reads its 30-minute average | 20 Nov 2026: `factory()`, `token0()`, `token1()`, `fee()`, the factory's `getPool` returning it, WBNB `symbol()` and `decimals()`, empty ERC-1967 slot, at block 134,739,204 (`docs/decisions/2026-11-20-payback-and-bem-price.md`) |
| Multicall3 (BNB Chain) | `0xca11bde05977b3631167028862be2a173976ca11`, the standard Multicall3: `aggregate3` bundles many view calls into one `eth_call` at one block. Not a proxy; no self-destruct or delegatecall in its source; code since block 15,921,452. Used to read the market's open listings in bundles (`2026-11-22-market-reads-multicall.md`) | 22 Nov 2026: Sourcify exact match of creation and runtime code on chain 56 (`Multicall3.sol:Multicall3`, solc 0.8.12); runtime code byte-identical to Ethereum's at the same address (hash `0xd5c15df6…770891`); empty ERC-1967 slot |
| TapePool account factory (X Layer), **third party** | `0xa9014e27dd17ea30e4fa4f71934645b9dcef8ac8` ("AgentFactory", TapePool's fourth deployment). `pool()` = the pool below; `isAgent(address)`; `AgentCreated(address indexed agent, address indexed borrower, uint256 index)`. Not upgradeable: a TapePool redeploy is a new factory, added here by hand | 20 Nov 2026: `pool()` read at block 76,432,567; TapePool's `script/Addresses.sol` and app config at commit `f6624ed8` (`docs/notes/2026-11-20-tapepool-lend.md`) |
| TapePool pool (X Layer), **third party** | `0x1a9a9850d597d8e3a03afae48e3ac8e2d4aec9d7`, not a proxy; owner `0x19a953e83c4cfdffff2fd336f3857c52d99045ba` (a wallet). Lends BEM against RIG vouchers in its accounts: fee 25 bps (7 days) / 50 bps (14 days), at least 0.001 BEM; smallest advance 0.01 BEM; at most 4 BEM per borrower; operating fee 0 OKB; held 10.141 BEM | 20 Nov 2026: storage and view reads at block 76,432,394; empty ERC-1967 slot |
| TapePool quote calculator (X Layer), **third party** | `0xfcc669bc9cca397cb01804035d5be981d7389ef2` ("TapeLens"). `quote(account, term)` (term 0 = 7 days, 1 = 14) returns the largest advance, fee, operating fee and a reason code (0 = OK, 1 to 16). Code not matched byte for byte to TapePool's source | 20 Nov 2026: `principalFor(pool, term, limit)` matched the pool's `fee()` at block 76,432,940 |
| ForemanResults (X Layer **testnet**, chain 1952) | `0xe1b2343d3da66afec740c0fcaf40a701e2d513e8`, Foreman's results contract (`contracts/src/ForemanResults.sol`), not upgradeable. Owner `0xa1a6f73a2443446204fb850effc9452597515ab8` (William's, can only replace the publisher); publisher `0x2ef2fed3f9b3d5385499008051031320b1fb49ef` (William's development wallet, also the deployer). Deployed by William in transaction `0x90a98040…bfb05`, block 46,796,339. Mainnet (196): not deployed | 21 Nov 2026: runtime code byte-identical to `forge build` with the owner filled into its 2 immutable slots; `owner()` and `publisher()` read; deploy receipt status 1, from the publisher; `resultOf` empty before the first publish. Source verified on Sourcify, exact match of creation and runtime code (21 Nov 2026) |

**Unconfirmed** (from other projects' READMEs, do not use until checked): X Layer TapeOut factory `0x1f09daefa827f02cbb40967cc91b259763760761` and account opener `0x536add8f30f03b69f6fbf29d425a816a0dc50106` (TapeKit/DeWEB per TapePool's config, implementations unverified), circuit market `0xd89f358c48a7B632c9845af2a02A32eB90DD75DB`. **Third party, not protocol:** TapePool (lending, another hackathon entry; its live contracts are above, its three earlier deployments are paused or unread, and on 20 Nov none of the 16 RIG vouchers was deposited with it: `docs/notes/2026-11-20-tapepool-lend.md`) and RIG orders on Seaport 1.6 via OwlGate's order book. No rental venue exists. See `docs/notes/2026-11-19-xlayer-market-findings.md`.

**RPC notes:** `bsc-dataseed.bnbchain.org` refuses `eth_getLogs`; `bsc-rpc.publicnode.com` serves it in 200-block chunks. Several public nodes return 403 or reset the connection. Batch reads and cache by block. On X Layer, the public `rpc.xlayer.tech` serves `eth_getLogs` only 100 blocks at a time (20 Nov 2026).

**X Layer public node limits, 21 Nov 2026** (the first testnet publish, `testrpc.xlayer.tech`; mainnet's `rpc.xlayer.tech` refuses large batches the same way): at most 10 calls in one JSON-RPC batch ("too many RPC calls in batch request"); a transaction over 131,072 bytes is refused ("oversized data"), so publish batches are cut by size; a receipt can take minutes; and the node can accept a transaction and time out before returning its hash, so the publish job signs first and records a landed batch with `--recover`. viem refuses a response over 10 MB, so large log reads go unbatched.

**RPC correction, 19 Nov 2026:** `bsc-rpc.publicnode.com` returns an **empty list, not an error,** for event logs older than a few hours. A read that needs history uses an archive node (`BNB_ARCHIVE_RPC_URL` in `.env`) and checks a known event is present before trusting an empty result.

**BNB nodes, 21 Nov 2026** (`docs/decisions/2026-11-21-bnb-nodes.md`): NodeReal's free monthly quota ran out. Every BNB read now goes through `bnbClient` (`packages/chain-bnb`):
- **publicnode** for reads and logs within 5,000 blocks of the head. It serves state about 10,000 blocks back and refuses older reads with an error. It refuses a log read with no address, or with more than 10 addresses, so a follow reads tape-outs only from processors whose `nextId` grew.
- **Alchemy** (`BNB_ARCHIVE_RPC_URL`) for older reads. Its free tier allows logs 10 blocks per read, about 500 compute units a second (bursts get HTTP 429) and 30 million a month: too little for the jobs, enough for catching up and backfills.

**Tape-out scan, 20 Nov 2026:** on the archive node, `eth_getLogs` for `TapedOut` with no address filter returns every processor's tape-outs, 1 to 3 seconds per 50,000 blocks (about 372 reads since the first tape-out at block 116,070,652). Keep only factory-listed processors, and check each processor's event count against its `nextId()`, which returns the last id issued, not the next.

---

## Tech stack

Each item gets 2–3 options, William chooses, it gets an ADR in `docs/decisions/`, then it is filled in here. Items still marked Open are not decided.

| Job | Status |
| --- | --- |
| Reading BNB Chain and X Layer | TypeScript with viem 2.57.16; `packages/chain-bnb` and `packages/chain-xlayer`; tests on saved RPC responses: `2026-11-19-chain-readers.md` |
| Circuit index and originality check | TypeScript in `packages/originality`; every BNB Chain processor, tape-outs from one `TapedOut` scan with a per-processor count check, stored in Postgres (local until hosting is chosen), followed every 5 minutes: `2026-11-20-circuit-index.md` |
| Valuation | TypeScript; token amounts as `bigint`, never `number`: `2026-11-18-language.md`, `2026-11-18-valuation-model.md` |
| API and job runner | Hono on Node, Postgres, pg-boss: `2026-11-18-api-and-jobs.md`. Database access: `pg` with plain SQL, numbered SQL migrations, the index's storage in `packages/index`, local Postgres from `docker-compose.yml`: `2026-11-20-database-access.md`. Hosting open |
| Results contract on X Layer | Solidity with Foundry in `contracts/`; not upgradeable; one publisher address, replaceable by William's separate owner wallet; a short verdict per circuit in storage, the full `Originality` JSON in the event log, tied by its hash; originality only; testnet (chain 1952) first: `2026-11-21-results-contract.md` |
| Frontend | Vite, React, wagmi and viem; static build for DeWEB, OKX Wallet first: `2026-11-18-frontend.md` |
| Package manager and layout | pnpm workspaces: `2026-11-18-package-layout.md` |

---

## Repository layout

pnpm workspaces (`docs/decisions/2026-11-18-package-layout.md`). Everything is William's.

| Path | What |
| --- | --- |
| `packages/contract` | The data contract's types and parsers (written by Furqaan). Parsers for the withdrawn autopilot shapes are removed in a later commit |
| `packages/chain-bnb` | BNB reader: `Miner`, `NetworkState`, network history, the circuit market's listings and sales (written by Furqaan) |
| `packages/valuation` | Valuation engine and backtests |
| `packages/originality` | Netlist reader, hashing, copy and wrapper checks, the tape-out scan. No database |
| `packages/index` | The circuit index's storage: SQL migrations, saving a scan, reading the index back, the record of what was published, and each eligible circuit's holder, followed from the processors' `Transfer` events with the rest of the index (`pg`; `2026-11-22-wallet-miners.md`) |
| `packages/chain-xlayer` | X Layer reader: RIG vouchers (the one standing for a miner, or every voucher a wallet holds) and TapePool Lend offers (live quote or no offer with its reason; the live quote tested on a local copy of X Layer). Planned: the results contract |
| `contracts/` | The X Layer results contract, `ForemanResults` (Foundry: `forge test` in `contracts/`), and its deploy script `script/DeployForemanResults.s.sol`, which William runs with his own keystore. On the testnet since 21 Nov 2026 (On-chain facts); not on mainnet. `2026-11-21-results-contract.md` |
| `apps/api` | The publish job (`pnpm --filter @foreman/api publish-results`: a dry run writes the plan to `data/`, `--send` sends it with `PUBLISHER_KEY`; refuses a chain whose results contract isn't deployed), `2026-11-21-publish-job.md`. The results job (`pnpm --filter @foreman/api refresh-results`, after the follow: what the follow touched, everything once an hour), `2026-11-21-stored-results.md`. The Hono API (`pnpm --filter @foreman/api serve`): `GET /circuit/:processor/:tokenId` (`2026-11-21-circuit-page-reads.md`) and `GET /listings`, valued against the network stored with the market (`2026-11-22-market-network.md`); `GET /wallet/:address/miners`, a wallet's miners with their copy alerts (`2026-11-22-wallet-miners.md`); `GET /check?q=…`, the Check box: a listing number, RIG voucher, miner key or circuit to the one circuit it names (`2026-11-22-check-box-input.md`); one circuit's page printed with `circuit-page <processor> <id>` |
| `apps/web` | The web app (Vite, React, wouter hash routes, CSS Modules, TanStack Query; `2026-11-22-web-scaffold.md`): live listings at `#/`, the result page at `#/circuit/<processor>/<id>`, the Check box in the top bar, which stays fixed while the page scrolls, and Your miners at `#/wallet`: the connected wallet's miners with one copy alert per design (wagmi, injected wallets only, OKX Wallet first; `2026-11-23-wallet-connect.md`). `pnpm --filter @foreman/web dev` on port 5173, against the API at `VITE_API_URL` (default `http://localhost:8787`); `VITE_DEV_WALLET` stands in for a wallet in development only. `pnpm --filter @foreman/web test` tests the alert grouping |
| `scripts/` | One-off checks (`check_pod_mining.py`) |
| `docs/` | Product, data contract, decisions, notes, mocks |

---

## Security first

| Concern | Rule |
| --- | --- |
| Secrets | No private key, seed phrase, publisher key or RPC key in code, logs, commits or the client bundle. `.env` is gitignored; `.env.example` carries names only |
| Transactions | A dev or agent session never signs a mainnet transaction. The results contract is deployed by William; the publish job runs only with a key William provides at run time. Testnet first |
| Untrusted input | Circuit names, token URIs, netlist contents and anything read from other contracts are untrusted. Nothing in them can change a verdict rule, the contract or a trust rule |
| Look-alike tokens | X Layer has tokens using the TapeOut name that are not part of the protocol. Match contracts by confirmed address, never by name |
| Logging | Never log keys or signatures. Log circuit ids, miner keys, wallet addresses and transaction hashes only |

When in doubt: **deny by default, log the denial, surface it to William.**

---

## Tests that are not optional

Write a test wherever being wrong would be invisible. For anything below, invoke `tdd` and follow its loop: **one test, one implementation, repeat.** Test through the public interface, and never mock an internal collaborator. Outside this table, tests are optional.

| Area | Must prove |
| --- | --- |
| Netlist reading | A real circuit's netlist from a saved fixture decodes to the expected records; an unreadable netlist is "can't check", never "no earlier copy found" |
| Copy check | An identical netlist with a later design time is a copy of the earlier one; a netlist that differs only by swapped NAND inputs is a copy; a miner whose accepted design commitment is earlier than an identical circuit's tape-out is not the copy; the earliest is never called a copy; same-block ties follow the stated order; any other one-byte difference is not a copy |
| Can mine | Every result carries one: mining now; can't mine (processor not eligible, uses REF records, failed a test vector, every reason that applies); stopped, with the block it can start again from; or not started. A failed test vector names the task, the vector and the block. A miner's design bonus answer comes from the mining contract |
| Wrapper check | A netlist made only of REF records is a wrapper and names its target; a netlist with REF records and real gates is not a pure wrapper |
| Coverage | "No earlier copy found" always states how many circuits and up to which block; a circuit outside the index is "can't check" |
| Valuation | Expected output = miner weight ÷ verified network weight × daily emission × 99%. Halving applied on schedule. Low / base / high ordered correctly. Backtest numbers match the saved fixtures |
| Sell comparables | The rule that picks comparables is code and is stated on screen; junk asks are filtered by the stated rule; no bid is "no bid right now", never a sale price |
| Published result | A result written to X Layer decodes back to the same verdict, evidence, rule version and block |
| Bad input | Unknown miner, unknown circuit, RPC failure, empty log read on a node without history: a clear error, never a crash and never a silent zero or a silent "no copy" |

A verdict or a number shown to a user that no test covers is a bug waiting to be found on demo day.

---

## Build order

The build order table in `docs/PRODUCT.md` is the order. Build so each step works end to end before the next.

**Feature freeze is 5 December 2026.** After that: bug fixes, the demo video and the submission only.

**Cut list, in this order, if behind on 1 December:** OCCC status → copy alert → Lend read (show "not checked") → X Layer mainnet (publish on testnet for the demo).

**Never cut:** the evidence behind every originality result, the inputs behind every value, and publishing results on X Layer.

---

## Copy

- Use the product's words exactly (see "Domain language").
- Plain language. No ABI, RPC or contract jargon in the UI.
- Say "estimated value", never "price", for Foreman's own numbers. Never "guaranteed", never "you should".
- Every copy result and every "No earlier copy found" states the limit: "Checks identical netlists, including swapped gate inputs. A copy with its gates reordered isn't detected."
- Originality copy states facts: "Copy of circuit #X", "Wrapper of circuit #X", "Identical to N earlier circuits; too small to tell", "No earlier copy found among N circuits", "Can't check". Facts beside a verdict stay facts: "taped out by the same address", "1,204 of its 1,209 gates come from other circuits". Never "fake", "stolen", "scam" or "authentic".
- Mobile first, OKX Wallet first.

---

## Domain language (use exactly)

| Term | Meaning |
| --- | --- |
| **Buyer** | Primary user. Someone considering buying a miner or a RIG voucher |
| **Owner** | Holds one or more miners |
| **Circuit** | A taped-out TapeOut netlist, held as an NFT on a processor |
| **Miner** | A circuit registered for Proof of Design mining that earns BEM |
| **Can mine** | The fact every result carries: "Mining now"; "Can't mine" (processor isn't eligible, uses REF records, or failed a test vector); "Not mining: stopped" (with when it can start again); or "Could mine: not started". Never a promise that a circuit passes a task |
| **RIG voucher** | An X Layer NFT standing for one miner held in the BNB rig vault |
| **Netlist** | A circuit's list of records (gates, latches, REF records) as stored on chain |
| **Netlist hash** | The hash of a netlist's input count, output count and bytes, with each NAND's two inputs put in order first, used to find exact copies |
| **REF record** | A netlist record that points to another circuit instead of containing gates |
| **Copy** | A miner or listed circuit whose netlist hash (input and output counts, bytes, NAND inputs in order) matches a circuit with an earlier design time, at or above the size floor. Design time is the design commitment block if the mining contract accepted one before the tape-out, otherwise the tape-out block |
| **Too small to tell** | The verdict when a miner is identical to earlier circuits but below the stated size floor (4 gates, `2026-11-20-size-floor.md`), where honest circuits match by nature |
| **Wrapper** | A circuit whose netlist is only REF records pointing to another circuit. Named with its direct target and the circuit at the end of the chain that holds the gates |
| **No earlier copy found** | The verdict when no earlier circuit in the index shares the netlist hash and the netlist is not a wrapper. Never shortened to "original" |
| **Can't check** | The verdict when the netlist can't be read or the circuit is outside the index |
| **OCCC** | Official Curated Circuit Collections: a TAP proposal certifying new collections by their issuer |
| **Index** | Every circuit Foreman has read, up to a stated block |
| **Result** | One circuit's verdict with its evidence, rule version and block |
| **Published result** | A result written to Foreman's results contract on X Layer |
| **Miner key** | The 32-byte id the mining contract uses for a miner |
| **Weight** | A miner's share-determining figure in the mining contract |
| **Network weight** | Total verified weight across all miners |
| **Emission** | BEM produced per day by the mining contract (7,200 today, halving about every four years) |
| **Estimated value** | Foreman's low / base / high value for a miner under stated assumptions |
| **Payback** | Days until a buyer's price is earned back, as a range |
| **Hold / Sell / Lend / Rent** | The four options for a miner. Never invent others in copy |
| **Offer** | A live bid, loan term or rental rate. Today only TapePool can supply one |
| **Copy alert** | "A copy of your miner was just listed", for owners who connect a wallet |

Never abbreviate these. Never invent synonyms.

---

## Still open

The `grill-me` queue. Strike an item when an ADR settles it.

- ~~Where netlists are stored on chain, and the exact REF record format (TAP-02 §4, §6).~~ Settled: `docs/notes/2026-11-20-netlist-storage.md` and `docs/decisions/2026-11-20-copy-and-wrapper-rules.md`.
- ~~The size floor below which an identical miner is "too small to tell": measure it from the index (`2026-11-20-copy-and-wrapper-rules.md`, decision 3).~~ Settled: 4 gates, `docs/decisions/2026-11-20-size-floor.md`.
- ~~Can a REF-only wrapper or an exact copy mine, and with what weight?~~ Settled: `docs/notes/2026-11-20-what-can-mine.md` and `docs/decisions/2026-11-20-verdict-scope-and-earliest-design.md`.
- ~~How to index every circuit since launch: tape-out events, archive node limits, and X Layer circuits.~~ Settled: `docs/decisions/2026-11-20-circuit-index.md` (BNB Chain only for the MVP).
- Is OCCC deployed anywhere, and how is its status read?
- ~~The results contract on X Layer: its shape, tooling, and who holds the publisher key.~~ Settled: `docs/decisions/2026-11-21-results-contract.md`.
- Price conversion: ~~BNB against BEM~~ settled by `docs/decisions/2026-11-20-payback-and-bem-price.md` (the BEM/WBNB pool's 30-minute average). Still open: OKB against BEM, for RIG vouchers priced on X Layer.
- Hosting for the API, the jobs and Postgres.
- Furqaan's agreement to reuse his code in the submission, and how he's credited.

---

## What the agent cannot do

- Change the trust rules, the verdict rules or the data contract without William.
- Let a model call produce a verdict, a value or a comparison.
- Call a circuit original, fake or stolen.
- Show a verdict without its evidence, or a value without its inputs.
- Sign or send a mainnet transaction, or handle a real private key, seed phrase or publisher key.
- Use a contract address that is not in "On-chain facts".
- Deploy anything.
- Add a dependency without saying what it replaces and what it costs.
- Commit or push without being asked, each time.
- Write a batch of documents without first showing the file list and getting a yes.
- Build a frontend page before William has chosen its mock.
