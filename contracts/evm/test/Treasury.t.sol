// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Treasury} from "../src/Treasury.sol";
import {TreasuryFactory} from "../src/TreasuryFactory.sol";

contract MockUSDC {
    mapping(address => uint256) public balanceOf;
    bool public failTransfers;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function setFailTransfers(bool fail) external {
        failTransfers = fail;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (failTransfers) return false;
        require(balanceOf[msg.sender] >= amount, "insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract TreasuryTest is Test {
    address private owner = address(0xA11CE);
    address private relayer = address(0xB0B);
    address private recipient = address(0xCAFE);
    MockUSDC private usdc;
    Treasury private treasury;

    function setUp() public {
        usdc = new MockUSDC();
        treasury = new Treasury();
        treasury.initialize(owner, relayer, address(usdc));
        usdc.mint(address(treasury), 1_000e6);
    }

    function testOnlyRelayerCanPayout() public {
        vm.expectRevert("not relayer");
        treasury.payout(bytes32("req"), recipient, 10e6);

        vm.prank(relayer);
        treasury.payout(bytes32("req"), recipient, 10e6);
        assertEq(usdc.balanceOf(recipient), 10e6);
    }

    function testOwnerCanWithdraw() public {
        vm.prank(owner);
        treasury.withdraw(owner, 25e6);
        assertEq(usdc.balanceOf(owner), 25e6);
    }

    function testOnlyOwnerCanWithdrawOrSetRelayer() public {
        vm.expectRevert("not owner");
        treasury.withdraw(owner, 1);

        vm.expectRevert("not owner");
        treasury.setRelayer(address(0xD00D));

        vm.expectRevert("not owner");
        treasury.setAuthorizedAgent(address(0xA6E17));

        vm.prank(owner);
        treasury.setRelayer(address(0xD00D));
        assertEq(treasury.relayer(), address(0xD00D));

        vm.prank(owner);
        treasury.setAuthorizedAgent(address(0xA6E17));
        assertEq(treasury.authorizedAgent(), address(0xA6E17));
    }

    function testRejectsDoubleInitialize() public {
        vm.expectRevert("already initialized");
        treasury.initialize(owner, relayer, address(usdc));
    }

    function testTransferFailureReverts() public {
        usdc.setFailTransfers(true);
        vm.prank(relayer);
        vm.expectRevert("transfer failed");
        treasury.payout(bytes32("req"), recipient, 10e6);
    }

    function testRequestCannotExecuteTwice() public {
        bytes32 requestId = bytes32("only-once");
        vm.prank(relayer);
        treasury.payout(requestId, recipient, 10e6);

        vm.prank(relayer);
        vm.expectRevert("already executed");
        treasury.payout(requestId, recipient, 10e6);
    }

    function testNativeTreasuryPaysAndWithdraws() public {
        Treasury nativeTreasury = new Treasury();
        nativeTreasury.initialize(owner, relayer, address(0));
        vm.deal(address(nativeTreasury), 2 ether);

        vm.prank(relayer);
        nativeTreasury.payout(bytes32("native"), recipient, 1 ether);
        assertEq(recipient.balance, 1 ether);

        vm.prank(owner);
        nativeTreasury.withdraw(owner, 1 ether);
        assertEq(owner.balance, 1 ether);
    }

    function testFactoryCreatesInitializedClone() public {
        Treasury implementation = new Treasury();
        TreasuryFactory factory = new TreasuryFactory(address(implementation));

        vm.prank(owner);
        address clone = factory.createTreasury(relayer, address(usdc));

        assertEq(Treasury(payable(clone)).owner(), owner);
        assertEq(Treasury(payable(clone)).relayer(), relayer);
        assertEq(Treasury(payable(clone)).authorizedAgent(), relayer);
        assertEq(address(Treasury(payable(clone)).token()), address(usdc));
    }
}
