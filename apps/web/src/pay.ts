// Paying ForemanPro on the X Layer testnet, shared by the Pro page (a chat's code,
// 2026-11-26-pro-payments.md) and the API page's pay band (a wallet's code,
// 2026-11-26-paid-api-tier.md): send 0.01 test OKB with the code, wait for the block, then report the
// transaction to the API, which reads the receipt itself. Nothing here decides what was paid: the
// chain and the API do.

import {
	FOREMAN_PRO,
	foremanProAbi,
	PRO_PRICE_WEI,
} from "@foreman/chain-xlayer/pro";
import { type Hex32, parseHex32 } from "@foreman/contract";
import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import {
	useBalance,
	useConnection,
	usePublicClient,
	useSwitchChain,
	useWriteContract,
} from "wagmi";
import { ApiProblem, reportProPayment } from "./api.ts";
import { xLayerTestnet } from "./wallet.ts";

/** The X Layer team's testnet faucet, on OKX's own site: 0.2 test OKB a day (checked 26 Nov 2026). */
export const FAUCET_URL = "https://web3.okx.com/xlayer/faucet";

/** Tries of the report while the API can't read the transaction yet, 3 seconds apart. */
const REPORT_TRIES = 10;

export type PayStep =
	| { at: "idle" }
	| { at: "wallet" }
	| { at: "block"; hash: Hex32 }
	| { at: "counting"; hash: Hex32 }
	/** Counted; `proUntil` is the chat's new end, or null for a code that is no chat's (a wallet's). */
	| { at: "counted"; hash: Hex32; proUntil: bigint | null }
	/** Paid, but the API hasn't counted it: the worker's own read will. */
	| { at: "uncounted"; hash: Hex32 }
	| { at: "problem"; detail: string };

/** One payment to ForemanPro with `code` (32 bytes), from the connected wallet. */
export function useProPayment(code: `0x${string}`) {
	const { address, chainId } = useConnection();
	const balance = useBalance({
		address,
		chainId: xLayerTestnet.id,
		query: { enabled: Boolean(address) },
	});
	const client = usePublicClient({ chainId: xLayerTestnet.id });
	const switchChain = useSwitchChain();
	const write = useWriteContract();
	const [step, setStep] = useState<PayStep>({ at: "idle" });

	// Another wallet starts over
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset on a change of wallet only
	useEffect(() => {
		setStep((now) =>
			now.at === "idle" || now.at === "problem" ? { at: "idle" } : now,
		);
	}, [address]);

	const held = balance.data?.value;

	async function pay() {
		if (!address || !client) return;
		setStep({ at: "wallet" });
		let hash: Hex32;
		try {
			hash = parseHex32(
				(
					await write.mutateAsync({
						address: FOREMAN_PRO.address as `0x${string}`,
						abi: foremanProAbi,
						functionName: "pay",
						args: [code],
						value: PRO_PRICE_WEI,
						chainId: xLayerTestnet.id,
					})
				).toLowerCase(),
				"tx",
			);
		} catch (error) {
			const name = (error as { name?: string }).name ?? "";
			setStep({
				at: "problem",
				detail: /UserRejected/.test(name)
					? "You didn’t confirm in your wallet, so nothing was paid."
					: "Your wallet couldn’t send the payment, so nothing was paid.",
			});
			return;
		}

		// X Layer receipts can take minutes (CLAUDE.md, "X Layer public node limits")
		setStep({ at: "block", hash });
		try {
			const receipt = await client.waitForTransactionReceipt({
				hash,
				timeout: 180_000,
			});
			if (receipt.status !== "success") {
				setStep({
					at: "problem",
					detail: "The payment failed on chain, so nothing was paid.",
				});
				void balance.refetch();
				return;
			}
		} catch {
			// The receipt read gave up; the payment may still land. The API and the worker read it
			// from the chain, so it is counted if it did
			setStep({ at: "uncounted", hash });
			return;
		}
		void balance.refetch();

		setStep({ at: "counting", hash });
		for (let i = 0; i < REPORT_TRIES; i++) {
			try {
				const answer = await reportProPayment(hash);
				setStep({ at: "counted", hash, proUntil: answer.proUntil });
				return;
			} catch (error) {
				const notYet =
					error instanceof ApiProblem && error.problem.error === "not-ready";
				if (!notYet) break;
				await new Promise((r) => setTimeout(r, 3000));
			}
		}
		setStep({ at: "uncounted", hash });
	}

	function switchToTestnet() {
		switchChain.mutate(
			{ chainId: xLayerTestnet.id },
			{
				onError: () =>
					setStep({
						at: "problem",
						detail:
							"Your wallet didn’t switch to the X Layer testnet. Switch it there, then pay.",
					}),
			},
		);
	}

	return {
		address,
		step,
		pay,
		switchToTestnet,
		switching: switchChain.isPending,
		onTestnet: chainId === xLayerTestnet.id,
		/** What the wallet holds on the testnet, in wei; undefined while unread. */
		held,
		heldUnreadable: balance.isError,
		/** Too little to pay 0.01. */
		short: held !== undefined && held < PRO_PRICE_WEI,
		busy: step.at === "wallet" || step.at === "block" || step.at === "counting",
		ready: Boolean(client),
	};
}

/** Test OKB from wei, to at most 4 decimals: "0.42", "0.0041". Display only. */
export function okb(wei: bigint): string {
	const [whole, frac = ""] = formatUnits(wei, 18).split(".");
	const cut = frac.slice(0, 4).replace(/0+$/, "");
	return cut ? `${whole}.${cut}` : (whole ?? "0");
}
