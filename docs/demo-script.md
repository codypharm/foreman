# Demo video script

Three minutes at most, covering what the hackathon asks the video for: the problem, the core features, the target users and business model, and how Foreman uses TapeOut and X Layer.

Rewritten 27 Nov 2026 as a story, to William's direction:
- **It leads with value.** Every trade has two sides: an owner deciding whether to sell, and a buyer deciding whether to buy. Both ask what a miner is worth.
- **Copies come second**, as the check nobody else does and what markets and lenders pay for.
- **The opening names all three things Foreman does:** value, copies, and watching for copies.

William records the clips (the shot list below) and narrates in his own voice, recorded last. The video is built in HyperFrames, 16:9 at 1920×1080.

Numbers in ⟨angle brackets⟩ are what the live site said on 27 Nov 2026; read them again on recording day. About 420 spoken words: 2:48 at 150 a minute, with the cards and pauses in between.

## How to read it

Talk to one person, not to a room. Short sentences. Leave the numbers and the evidence on screen and say what they mean. Where a line has a pause (·), let the picture breathe. Change any word that doesn't sound like you, as long as the facts stay the same and the words in "Words to keep" hold.

## Script

### 0:00–0:30 · Two sides of one trade

**On screen:** listing ⟨28111⟩ on TapeOut's market, ⟨2.36⟩ BNB. A caption on each side: "Owner: sell or keep mining?" and "Buyer: fair price?". Then asks side by side, then a Foreman result page and a copy alert.

> Here's a miner for sale on TapeOut, for ⟨two point three six⟩ BNB.
> If you own it, you're asking: do I sell, or keep mining? And has anyone copied it?
> If you're buying: is that a fair price? Or is it a copy of an earlier circuit?
> For the same output, some sellers ask ⟨sixteen⟩ times what others do. And a copy looks just like the circuit it copies. ·
> Foreman answers both sides, straight from the chain. And it keeps watching for copies, so you don't have to.

### 0:30–0:55 · The owner

**On screen (development build, captioned "A real owner's wallet, viewed read-only"):** My miners, then circuit ⟨#97⟩'s result page: Worth?, then Options, Hold and Sell. Then its copy alert.

> Start with an owner. This wallet designed circuit ⟨ninety-seven⟩, and still mines with it.
> Foreman says it should earn about ⟨eighteen⟩ BEM in the next thirty days. Similar miners just sold for ⟨four point two to five⟩ BNB. ·
> Now selling is a decision, not a guess.
> And right now, a copy of this circuit is listed, for ⟨a tenth of a⟩ BNB.

### 0:55–1:20 · The buyer

**On screen:** the live listings page, each ask beside its estimated output. Paste ⟨28111⟩ into the Check box; the result page opens. Worth? and payback.

> Now the buyer. Here's every miner for sale, with what each should earn right beside its price.
> Our miner should earn about ⟨eight⟩ BEM every thirty days. At today's BEM price, ⟨two point three six⟩ BNB takes about ⟨eight hundred⟩ days to pay back. ·
> Every input is shown, and it's a range, never a single price.

### 1:20–1:40 · The check nobody else does

**On screen:** Original?, then a zoom on the evidence: both tape-outs and the shared netlist hash.

> Then the check nobody else does. This miner is a copy. The same netlist as circuit ⟨sixty-seven seventy-four⟩, byte for byte, taped out ⟨three weeks⟩ earlier by a different address. ·
> A copy still mines, just without the design bonus. Foreman doesn't judge. It shows you the facts.

### 1:40–1:52 · Anyone can check it

**On screen:** the Published panel; press "Read it back from the contract"; the answer: the X Layer testnet transaction and block, and that the stored hash matches.

> Every answer is published on X Layer, with the block it was read at. The page reads it back from the chain, so anyone can check it.

### 1:52–2:04 · Across two chains

**On screen:** type "FabX 24" in the Check box; the FabX · X Layer result: "Copy of circuit #97 on BNB Chain".

> Copies cross chains too. Remember circuit ⟨ninety-seven⟩? On FabX, on X Layer, there's an identical circuit, taped out fifty-seven days later.

### 2:04–2:14 · Watching for copies

**On screen:** My miners' "Get copy alerts on Telegram" button; Telegram opens; the bot confirms it's following the wallet.

> Owners don't have to keep checking. Follow your wallet on Telegram, and Foreman messages you when a copy of your miner is listed.

### 2:14–2:32 · How it uses TapeOut and X Layer

**On screen:** the architecture diagram, then the contract addresses.

> Under the hood, Foreman follows TapeOut's mining contract and market on BNB Chain, and FabX, RIG vouchers and TapePool on X Layer. It has checked ⟨eighty-seven thousand⟩ circuits, and publishes changes every five minutes.

### 2:32–2:50 · Who pays

**On screen:** the business model card: free, paid, next.

> Checking is free, for buyers and owners. Owners pay for Foreman Pro, to watch up to twenty wallets. Markets and lenders pay on X Layer for ten times the API calls, to check every listing before they list or lend. Both payments work today, on testnet.

### 2:50–3:00 · Close

**On screen:** the site's address.

> Foreman. Know what it's worth, know what it is, and know when it's copied, before you trade.

## Shot list

William records each clip with macOS screen recording (Cmd+Shift+5, "Record Selected Portion" set to 1920×1080, or the whole screen on a 1080p-or-larger display). One clip per file, named as below, saved to `video/clips/` (kept out of git). Record each clip **about twice as long as it's used**: start still for 2 seconds, move the pointer slowly, and hold still for 3 seconds on anything that gets zoomed.

**Set up once:** the site in dark mode; a desktop browser window filling the recording area; bookmarks bar and other tabs hidden; browser zoom 100% (110% if the text looks small at 1080p); Focus mode on so no notifications appear; pointer visible.

| Clip | Scene | Where | What to do | Use |
| --- | --- | --- | --- | --- |
| `c01-market.mov` | 0:00 | `tapeout.net`, Circuit market (电路市场) in the sidebar, switched to EN at the bottom left | Type ⟨13931⟩ in the market's search box; hold on its row and price ⟨2.36⟩ BNB | 4 s |
| `c02-listings.mov` | 0:00, 0:55 | `foreman-eight-beta.vercel.app/#/` | Slow scroll through the listings, past asks and estimated outputs; stop on listing ⟨28111⟩'s row, shown as "Circuit ⟨#13931⟩ · ⟨2.36⟩ BNB" (rows are named by circuit) | 10 s |
| `c03-your-miners.mov` | 0:30 | Development build with the dev wallet: the `foreman-web-dev-wallet` launch entry (port 5174) with `VITE_API_URL` set to the hosted API | Open My miners; scroll to circuit ⟨#97⟩ and its copy alert; hold | 6 s |
| `c04-owner-97.mov` | 0:30 | Result page `#/circuit/0xb1024b89886b9a34aa4ff5f31c411d708b20a14c/97` | Scroll to Worth?, hold; scroll to Options, hold on Hold and Sell | 12 s |
| `c05-check-28111.mov` | 0:55 | Live site, any page | Click the Check box, type ⟨28111⟩, press Check; the result page opens | 5 s |
| `c06-worth-13931.mov` | 0:55 | Result page for ⟨#13931⟩ | Scroll to Worth?; hold on the range and payback | 8 s |
| `c07-original-13931.mov` | 1:20 | Same page | Scroll back to Original?; hold 6 s on the evidence (both tape-outs and the hash) | 10 s |
| `c08-published.mov` | 1:40 | Same page, Published panel | Hold on the panel; press "Read it back from the contract"; hold 4 s on the answer (transaction, block, the hash matching) | 10 s |
| `c09-fabx-24.mov` | 1:52 | Live site | Type "FabX 24" in the Check box; hold on "Copy of circuit #97 on BNB Chain" | 8 s |
| `c10-telegram.mov` | 2:04 | My miners (development build), then Telegram | Click "Get copy alerts on Telegram"; Telegram opens the bot; press Start; hold on its reply | 8 s |
| `c11-api.mov` (optional) | 2:32 | `#/api` | Slow scroll: the call beside its answer, then the pay band | 6 s |

**Made in HyperFrames, nothing to record:** the hook's asks side by side and the "⟨sixteen⟩ times" figure; the owner and buyer captions; zooms and highlights on the evidence, the transaction and the figures; the architecture diagram (`docs/diagrams/architecture-dark.svg`); the address card; the business model card; the close.

**Telegram, honestly:** the bot only messages a chat about copies listed after it starts following, so no alert can be recorded on demand. The clip shows following, not an alert. Nothing in the video imitates a message the bot didn't send.

## Before recording

| What | How |
| --- | --- |
| Today's numbers | The ⟨⟩ figures, from the live site: listing ⟨28111⟩'s ask, value and payback; circuit ⟨#97⟩'s Hold and Sell and its copy alert; circuits checked. The "⟨sixteen⟩ times" figure is the spread of asks per BEM of estimated 30-day output across the mining listings (the 90th percentile against the 10th), worked out again on the day |
| The listing | Check ⟨28111⟩ is still open. If not, pick another buyable copy listing whose earlier circuit was taped out by a different address, and change the buyer's lines to match |
| Its published result | Its Published panel shows the X Layer testnet transaction. If it says "not published yet", wait for the next worker run (5 minutes) |
| FabX #24 | "FabX 24" in the Check box: Copy of circuit #97 on BNB Chain, 57 days earlier |
| The owner | The dev wallet `0x077e…2ea5` is a real BNB Chain owner's public address. It taped out circuit #97 itself and still holds it. No wallet connects and no key is involved |

## Words to keep

From CLAUDE.md, "Copy" and "Domain language":
- **Use:** "copy of circuit #X", "no earlier copy found", "estimated value", "range", "should earn".
- **Never:** "original" on its own, "fake", "stolen", "scam", "price" for Foreman's numbers, or "official" for FabX. Never call an ask cheap or dear: say what it earns and how long it takes to pay back.
- **Payments:** Foreman Pro and the paid API work "on testnet", with a test amount. Never a price, and never on mainnet.
