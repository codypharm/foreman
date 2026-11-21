// Tests only: a local, empty X Layer testnet (anvil, chain id 1952) with ForemanResults compiled by
// forge and deployed from anvil's own unlocked dev accounts. No private key is used or stored, and
// nothing reaches a real network.

import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import {
	type Address as ContractAddress,
	parseAddress,
} from "@foreman/contract";
import {
	type Address,
	createPublicClient,
	createWalletClient,
	defineChain,
	type Hex,
	http,
	type PublicClient,
	type WalletClient,
} from "viem";
import { foremanResultsAbi } from "./abi.ts";

const FOUNDRY_BIN = [`${homedir()}/.foundry/bin`, ""];
const CONTRACTS = new URL("../../../../contracts/", import.meta.url);

function tool(name: string): string | null {
	for (const dir of FOUNDRY_BIN) {
		const path = dir ? `${dir}/${name}` : name;
		try {
			execFileSync(path, ["--version"], { stdio: "ignore" });
			return path;
		} catch {}
	}
	return null;
}

/** Where anvil and forge are, or null when Foundry isn't installed (the tests then skip). */
export const FOUNDRY =
	tool("anvil") && tool("forge")
		? { anvil: tool("anvil") as string, forge: tool("forge") as string }
		: null;

export interface LocalXLayer {
	publicClient: PublicClient;
	/** Wallets on anvil's dev accounts: [0] deployed and owns the contract, [1] is its publisher. */
	owner: WalletClient;
	publisher: WalletClient;
	contract: ContractAddress;
	stop(): Promise<void>;
}

export async function localXLayer(): Promise<LocalXLayer> {
	if (!FOUNDRY) throw new Error("Foundry (anvil, forge) is not installed");
	execFileSync(FOUNDRY.forge, ["build", "--root", CONTRACTS.pathname], {
		stdio: "ignore",
	});
	const artifact = new URL(
		"out/ForemanResults.sol/ForemanResults.json",
		CONTRACTS,
	);
	if (!existsSync(artifact)) throw new Error("forge build left no artifact");
	const bytecode = JSON.parse(readFileSync(artifact, "utf8")).bytecode
		.object as Hex;

	const port = 20_000 + Math.floor(Math.random() * 20_000);
	const anvil: ChildProcess = spawn(
		FOUNDRY.anvil,
		["--chain-id", "1952", "--port", String(port), "--silent"],
		{ stdio: "ignore" },
	);
	const url = `http://127.0.0.1:${port}`;
	const chain = defineChain({
		id: 1952,
		name: "local X Layer testnet",
		nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
		rpcUrls: { default: { http: [url] } },
	});
	const publicClient = createPublicClient({ chain, transport: http(url) });
	for (let i = 0; ; i++) {
		try {
			await publicClient.getChainId();
			break;
		} catch {
			if (i > 100) throw new Error("anvil did not start");
			await new Promise((r) => setTimeout(r, 50));
		}
	}
	const [ownerAddress, publisherAddress] = await createWalletClient({
		chain,
		transport: http(url),
	}).getAddresses();
	if (!ownerAddress || !publisherAddress) {
		throw new Error("anvil has no accounts");
	}
	const wallet = (account: Address) =>
		createWalletClient({ account, chain, transport: http(url) });
	const owner = wallet(ownerAddress);
	const hash = await owner.deployContract({
		abi: [
			{
				type: "constructor",
				stateMutability: "nonpayable",
				inputs: [
					{ name: "owner_", type: "address" },
					{ name: "publisher_", type: "address" },
				],
			},
			...foremanResultsAbi,
		],
		bytecode,
		args: [ownerAddress, publisherAddress],
		account: ownerAddress,
		chain,
	});
	const receipt = await publicClient.waitForTransactionReceipt({ hash });
	if (!receipt.contractAddress) throw new Error("deploy left no contract");
	return {
		publicClient,
		owner,
		publisher: wallet(publisherAddress),
		contract: parseAddress(receipt.contractAddress, "contract"),
		stop: () =>
			new Promise<void>((resolve) => {
				if (anvil.exitCode !== null || anvil.signalCode !== null) {
					return resolve();
				}
				anvil.once("exit", () => resolve());
				anvil.kill();
			}),
	};
}
