// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {Treasury} from "../src/Treasury.sol";
import {TreasuryFactory} from "../src/TreasuryFactory.sol";

contract VerifyDeployment is Script {
    function run() external view {
        address factoryAddress = vm.envAddress("FACTORY_ADDRESS");
        address implementation = TreasuryFactory(factoryAddress).treasuryImplementation();
        require(implementation != address(0), "missing implementation");
    }
}

