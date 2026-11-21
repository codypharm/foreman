// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ForemanResults} from "../src/ForemanResults.sol";

/// @notice Deploys ForemanResults (docs/decisions/2026-11-21-results-contract.md). William runs it
///         with his own wallet; no key is ever in this repo. The owner and publisher are addresses,
///         read from the environment:
///
///   FOREMAN_OWNER=0x... FOREMAN_PUBLISHER=0x... forge script script/DeployForemanResults.s.sol \
///     --rpc-url xlayer_testnet --account <keystore name> --broadcast
contract DeployForemanResults is Script {
    function run() external returns (ForemanResults results) {
        require(block.chainid == 1952 || block.chainid == 196, "X Layer testnet (1952) or mainnet (196) only");
        address owner = vm.envAddress("FOREMAN_OWNER");
        address publisher = vm.envAddress("FOREMAN_PUBLISHER");
        // The owner can replace a leaked publisher only if it is a different wallet (decision 3)
        require(owner != publisher, "the owner and the publisher must be different wallets");

        vm.startBroadcast();
        results = new ForemanResults(owner, publisher);
        vm.stopBroadcast();

        require(results.owner() == owner && results.publisher() == publisher, "deployed with the wrong addresses");
        console.log("ForemanResults deployed at", address(results));
        console.log("chain id", block.chainid);
        console.log("owner", owner);
        console.log("publisher", publisher);
    }
}
