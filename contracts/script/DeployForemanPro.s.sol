// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ForemanPro} from "../src/ForemanPro.sol";

/// @notice Deploys ForemanPro (docs/decisions/2026-11-26-pro-payments.md). William runs it with his own
///         wallet; no key is ever in this repo. The X Layer testnet only: its 0.01 is a test amount, and
///         the real price isn't set. The owner, who receives withdrawals, is an address from the environment:
///
///   FOREMAN_OWNER=0x... forge script script/DeployForemanPro.s.sol \
///     --rpc-url xlayer_testnet --account <keystore name> --broadcast
contract DeployForemanPro is Script {
    function run() external returns (ForemanPro pro) {
        require(block.chainid == 1952, "X Layer testnet (1952) only: Pro's amount is a test amount");
        address owner = vm.envAddress("FOREMAN_OWNER");

        vm.startBroadcast();
        pro = new ForemanPro(owner);
        vm.stopBroadcast();

        require(pro.owner() == owner, "deployed with the wrong owner");
        console.log("ForemanPro deployed at", address(pro));
        console.log("chain id", block.chainid);
        console.log("owner", owner);
    }
}
