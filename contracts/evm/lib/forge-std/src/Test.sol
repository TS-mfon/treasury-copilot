// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface Vm {
    function prank(address msgSender) external;
    function expectRevert(bytes calldata revertData) external;
    function deal(address account, uint256 newBalance) external;
}

contract Test {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function assertEq(address actual, address expected) internal pure {
        require(actual == expected, "assertEq(address) failed");
    }

    function assertEq(uint256 actual, uint256 expected) internal pure {
        require(actual == expected, "assertEq(uint256) failed");
    }
}
