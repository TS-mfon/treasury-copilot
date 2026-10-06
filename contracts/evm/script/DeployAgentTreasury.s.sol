// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {AgentTreasury} from "../src/AgentTreasury.sol";
import {AgentTreasuryFactory} from "../src/AgentTreasuryFactory.sol";

/// @notice Deploys the Arc agent treasury implementation and its clone factory.
/// @dev Requires TOKEN_MESSENGER to be set to the chain's CCTP V2 TokenMessenger. Reading it
///      from the environment rather than hardcoding keeps the script honest about which Circle
///      deployment a given broadcast was wired to. Arc Testnet uses
///      0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA; see docs/arc.md.
///
///      Deploy to Arc with Arc Foundry, which handles Arc's protocol differences:
///        arc-forge script script/DeployAgentTreasury.s.sol \
///          --rpc-url https://rpc.testnet.arc.io --broadcast
contract DeployAgentTreasury is Script {
    function run() external returns (AgentTreasury implementation, AgentTreasuryFactory factory) {
        address tokenMessenger = vm.envAddress("TOKEN_MESSENGER");

        vm.startBroadcast();
        implementation = new AgentTreasury();
        factory = new AgentTreasuryFactory(address(implementation), tokenMessenger);
        vm.stopBroadcast();
    }
}
