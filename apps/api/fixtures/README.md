# API fixtures

## The result page: `circuit-page.json`

Recorded on 21 November 2026 by `scripts/record-page-fixture.ts` (`pnpm --filter @foreman/api record:page`), for `src/page/circuit-page.test.ts`. Read only, from public nodes: no archive node is needed, because every BNB Chain read is at a block a few behind the head.

| Part | What | Where from |
| --- | --- | --- |
| `bnb` | Every BNB Chain call the page makes for the three circuits below: `getMiner`, `ownerOf`, `processorMultiplier`, the network weights, the BEM/WBNB pool's price, block headers | `bsc-dataseed.bnbchain.org` at block 134,900,065 |
| `xlayer` | Every X Layer call: the head, the RIG vouchers (16 on that day) and their circuits | `rpc.xlayer.tech` at block 76,500,877 |
| `market` | The market index's block and time, set to the BNB block above | |
| `networkDays` | The 32 daily network samples up to 21 Nov 2026 00:00 UTC, for the growth rule | the local index's `network_days`, filled by the follow from chain data |

The index is the originality fixture's, at block 134,673,279 (`packages/originality/fixtures/README.md`), with its stored results built by the results job. So a stored result's block is older than the page's BNB block, as it can be in production.

| Circuit | On 21 Nov 2026 at block 134,900,065 | Covers |
| --- | --- | --- |
| `MINE6/2683` | Active, verified pool, holds the design bonus | Value, payback for the asking price, Sell comparables, one BNB block for every part |
| `MINE6/128` | Cooling (stopped by its owner) | No value and no payback, never a zero |
| `P0/6534` | Never a miner; a pure wrapper on a processor that can't mine | Built on request as "pasted", never stored or published |

**Made up by the test, and only this:** the open listing for `MINE6/2683` (listing 28,200, 2 BNB, listed 100 blocks before the market block) and, in one test, the published record. The listing's miner state is read from the recorded `getMiner`, as the market follow does.

**Not covered here:** an active miner in the unverified pool. None of the fixture index's miners is one; the contract's parser refuses any other state for it (`packages/contract/src/circuit-page.test.ts`).
