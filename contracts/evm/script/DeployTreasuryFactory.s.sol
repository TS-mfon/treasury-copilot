// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {Treasury} from "../src/Treasury.sol";
import {TreasuryFactory} from "../src/TreasuryFactory.sol";

contract DeployTreasuryFactory is Script {
    function run() external returns (Treasury implementation, TreasuryFactory factory) {
        vm.startBroadcast();
        implementation = new Treasury();
        factory = new TreasuryFactory(address(implementation));
        vm.stopBroadcast();
    }
}

