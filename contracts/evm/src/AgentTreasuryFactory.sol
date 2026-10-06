// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AgentTreasury} from "./AgentTreasury.sol";

/// @notice Minimal-proxy cloning, matching the implementation already used by TreasuryFactory.
library Clones {
    function clone(address implementation) internal returns (address instance) {
        assembly {
            let ptr := mload(0x40)
            mstore(ptr, 0x3d602d80600a3d3981f3363d3d373d3d3d363d73000000000000000000000000)
            mstore(add(ptr, 0x14), shl(0x60, implementation))
            mstore(add(ptr, 0x28), 0x5af43d82803e903d91602b57fd5bf30000000000000000000000000000000000)
            instance := create(0, ptr, 0x37)
        }
        require(instance != address(0), "clone failed");
    }
}

/// @title AgentTreasuryFactory
/// @notice Deploys one isolated AgentTreasury per owner, as the Arc roadmap requires.
/// @dev The CCTP TokenMessenger is fixed per chain at factory deployment so every vault is
///      wired to the correct Circle contracts without the caller supplying an address.
contract AgentTreasuryFactory {
    address public immutable treasuryImplementation;
    address public immutable tokenMessenger;

    event TreasuryCreated(
        address indexed owner, address indexed treasury, address executor, address token, address tokenMessenger
    );

    constructor(address _implementation, address _tokenMessenger) {
        require(_implementation != address(0), "implementation zero");
        treasuryImplementation = _implementation;
        tokenMessenger = _tokenMessenger;
    }

    /// @param executor Platform signer permitted to pay out GenLayer-approved requests.
    /// @param token USDC ERC-20 interface for the target chain.
    function createTreasury(address executor, address token) external returns (address clone) {
        clone = Clones.clone(treasuryImplementation);
        AgentTreasury(clone).initialize(msg.sender, executor, token, tokenMessenger);
        emit TreasuryCreated(msg.sender, clone, executor, token, tokenMessenger);
    }
}
