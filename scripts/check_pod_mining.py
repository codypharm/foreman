"""Check whether TapeOut PoD mining data is readable per miner on BNB Chain.

No installs needed (Python 3 standard library only). Run:  python3 check_pod_mining.py

What it does:
1. Finds recent BEM mints (Transfer events from the zero address) on the BEM token.
2. Prints the contract each mint transaction called: that should be the PodMining contract.
3. Prints every event emitted in those transactions, so we can see whether claims
   identify the miner (a miner ID or key in the topics or data) or only the wallet.
"""
import json
import sys
import urllib.request
from collections import Counter

RPCS = [
    "https://bsc-rpc.publicnode.com",
    "https://bsc.drpc.org",
    "https://1rpc.io/bnb",
    "https://bsc-dataseed1.defibit.io",
    "https://bsc-dataseed.bnbchain.org",
]
BEM_TOKEN = "0x5ce033b2bfca3af30b3e8c8457deaf776a8b695a"
TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
ZERO_TOPIC = "0x" + "0" * 64
MAX_TX = 5


def rpc(url, method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(url, body, {"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        out = json.load(r)
    if "error" in out:
        raise RuntimeError(out["error"])
    return out["result"]


def pick_rpc():
    for url in RPCS:
        try:
            n = int(rpc(url, "eth_blockNumber", []), 16)
            print(f"Connected to {url}, latest block {n}")
            return url, n
        except Exception as e:  # try the next node
            print(f"  {url} failed: {e}")
    sys.exit("No BNB Chain node reachable from this machine.")


def find_mints(head):
    """Walk back in small chunks, trying each node, until some mints are found."""
    chunk = 200
    for url in RPCS:
        print(f"\nSearching logs via {url}")
        end = head
        try:
            for _ in range(40):  # up to ~8,000 blocks back
                start = end - chunk + 1
                logs = rpc(url, "eth_getLogs", [{
                    "address": BEM_TOKEN,
                    "fromBlock": hex(start),
                    "toBlock": hex(end),
                    "topics": [TRANSFER, ZERO_TOPIC],
                }])
                if logs:
                    print(f"  found {len(logs)} mints in blocks {start}-{end}")
                    return url, logs
                end = start - 1
            print("  no mints found in range")
        except Exception as e:
            print(f"  log search failed: {e}")
    return None, []


def main():
    _, head = pick_rpc()
    url, logs = find_mints(head)
    if not logs:
        print("\nNo node returned BEM mint logs. Paste this output back.")
        return

    txs = []
    for lg in logs:
        if lg["transactionHash"] not in txs:
            txs.append(lg["transactionHash"])

    callees = Counter()
    for h in txs[:MAX_TX]:
        tx = rpc(url, "eth_getTransactionByHash", [h])
        rc = rpc(url, "eth_getTransactionReceipt", [h])
        callees[tx["to"]] += 1
        print("\n" + "=" * 70)
        print(f"tx {h}")
        print(f"  block {int(tx['blockNumber'], 16)}  from {tx['from']}  to {tx['to']}")
        print(f"  function selector {tx['input'][:10]}  input length {(len(tx['input']) - 2) // 2} bytes")
        for ev in rc["logs"]:
            print(f"  event from {ev['address']}")
            print(f"    topic0 {ev['topics'][0]}")
            for i, t in enumerate(ev["topics"][1:], 1):
                print(f"    topic{i} {t}")
            data = ev["data"][2:]
            words = [data[i:i + 64] for i in range(0, len(data), 64)]
            for i, w in enumerate(words[:8]):
                print(f"    data[{i}] 0x{w}")
            if len(words) > 8:
                print(f"    ... {len(words) - 8} more data words")

    print("\n" + "=" * 70)
    print("Contracts the mint transactions called (the mining contract should be here):")
    for addr, n in callees.most_common():
        print(f"  {addr}  ({n} tx)")
    print("\nPaste this whole output back into the chat.")


if __name__ == "__main__":
    main()
