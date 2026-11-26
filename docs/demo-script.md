# Demo video script

Three minutes, covering what the hackathon asks the video for: the problem, the core features, the target users and business model, and how Foreman uses TapeOut and X Layer. William narrates over a screen recording of the live site, except the Your miners scene (see "Before recording").

Numbers in ⟨angle brackets⟩ change every day. They show what the live site said on 26 Nov 2026; read them again on recording day. About 400 spoken words, at 150 a minute.

## Before recording

| What | How |
| --- | --- |
| Today's numbers | The live listings page's counts: open miner listings, and how many are copies. The FabX counts from the README stay as they are unless the index is rebuilt |
| The listing to check | A buyable copy listing whose earlier circuit was taped out by a different address at least a day before. On 26 Nov: listing ⟨28216⟩, circuit ⟨#8044⟩, **Copy of circuit ⟨#53⟩, taped out ⟨4 days⟩ earlier**, asking ⟨2.21⟩ BNB. Check it's still open; if not, pick another by the same rule from the listings page |
| Its published result | Its result page's Published panel shows the X Layer testnet transaction. If it says "not published yet", wait for the next worker run (5 minutes) |
| FabX #24 | Type "FabX 24" in the Check box. Copy of circuit #97 on BNB Chain, 57 days earlier |
| Your miners | Run the development build with the dev wallet: the `foreman-web-dev-wallet` launch entry (port 5174), with `VITE_API_URL` pointing at the hosted API, or the local API running. Its stand-in wallet `0x077e…2ea5` is a real BNB Chain owner's public address: on 26 Nov it held ⟨64⟩ miners, ⟨21⟩ with copy alerts. No wallet connects and no key is involved. Caption the scene "A real owner's wallet, viewed read-only" |
| Screen | Phone width or a narrow window, dark mode, to match the screenshots. Close other tabs; hide bookmarks |

## Script

### 0:00–0:20 · The problem

**On screen:** TapeOut's circuit market with miner listings; then a netlist shown twice, side by side, identical.

> TapeOut miners are circuits that earn BEM, and people pay real BNB for them. But anyone can tape out an identical copy of someone else's circuit, or a wrapper that only points to it, and list it for sale. From the listing, a buyer can't tell.

### 0:20–0:30 · What Foreman is

**On screen:** a result page scrolling through its three sections: Original?, Worth?, Options.

> Foreman answers three questions before you buy a miner: is it original, what's it worth, and what can you do with it. Every answer comes from chain data, and the originality results are published on X Layer.

### 0:30–0:45 · Live listings

**On screen:** the live listings page, scrolling past copy verdicts.

> This is every open miner listing on TapeOut's market right now. Of ⟨311⟩, ⟨86⟩ are copies of an earlier circuit.

### 0:45–1:05 · Is it original?

**On screen:** paste listing ⟨28216⟩ into the Check box; the result page opens on Original?.

> Paste any listing. This one is a copy of circuit ⟨53⟩: the same netlist, byte for byte, taped out ⟨four days⟩ earlier by a different address. Foreman shows both tape-outs and the shared hash, so anyone can check it. It says what it checked, against ⟨87,643⟩ circuits, and nothing more.

### 1:05–1:20 · What's it worth?

**On screen:** Worth? with the low, base and high range and its inputs; payback beside the ask.

> Next, an estimated value range from the miner's own weight and the network's emission, with every input shown, and how long the asking price takes to pay back. A range, never a price.

### 1:20–1:30 · Options

**On screen:** Hold, Sell, Lend, Rent.

> Hold, sell, lend or rent, each as it really is today. Where there's no offer, it says so.

### 1:30–1:45 · Published on X Layer

**On screen:** the Published panel; the testnet transaction in the explorer; back to the panel showing the hash matches.

> Every result is published to Foreman's contract on X Layer, with its rule version and block. The page reads it back from the chain and checks the hash matches.

### 1:45–1:55 · FabX, across two chains

**On screen:** type "FabX 24"; the FabX · X Layer panel, then "Copy of circuit #97 on BNB Chain".

> Foreman also checks FabX miners on X Layer against both chains. This FabX miner is identical to a circuit on BNB Chain, taped out 57 days earlier.

### 1:55–2:05 · Your miners

**On screen (development build, captioned):** Your miners with copy alerts.

> Owners connect a wallet and see their miners, with an alert when someone lists a copy of one.

### 2:05–2:30 · How it uses TapeOut and X Layer

**On screen:** the architecture diagram, then the README's address table.

> Under the hood, a worker follows TapeOut's mining contract, processors and market on BNB Chain, and FabX and TapeOut's processor factory on X Layer. It indexes every circuit, checks them, and publishes changed results to X Layer every five minutes. Pages also read RIG vouchers and TapePool live.

### 2:30–2:50 · Users and business model

**On screen:** the README's business model table.

> Buyers and owners use Foreman free. Next, owners pay for Foreman Pro, with alerts by Telegram, and markets and lenders pay for an API to check circuits before they list or lend. The published results stay free. We reach users with these facts in TapeOut's community, through result links shared before a trade, and through partners like OwlGate and TapePool.

### 2:50–3:00 · Close

**On screen:** the site's address and the rule.

> Foreman. Know what you're buying before you trade a TapeOut miner. It says only what it checked.

## Words to keep

From CLAUDE.md, "Copy" and "Domain language": "copy of circuit #X", "no earlier copy found", "estimated value", "range". Never "original" on its own, "fake", "stolen", "scam", "price" for Foreman's numbers, or "official" for FabX. Foreman Pro and the API are always "next".
