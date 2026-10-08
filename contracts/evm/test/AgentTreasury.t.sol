// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentTreasury} from "../src/AgentTreasury.sol";
import {AgentTreasuryFactory} from "../src/AgentTreasuryFactory.sol";

/// @dev Mirrors Arc's USDC ERC-20 interface: 6 decimals, boolean returns.
contract MockUSDC {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    bool public failTransfers;
    bool public failApprovals;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function setFailTransfers(bool fail) external {
        failTransfers = fail;
    }

    function setFailApprovals(bool fail) external {
        failApprovals = fail;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (failTransfers) return false;
        require(balanceOf[msg.sender] >= amount, "insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        if (failApprovals) return false;
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(allowance[from][msg.sender] >= amount, "allowance");
        allowance[from][msg.sender] -= amount;
        require(balanceOf[from] >= amount, "insufficient");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// @dev Records CCTP V2 burn calls and pulls the approved tokens, as the real messenger does.
contract MockTokenMessenger {
    MockUSDC private immutable usdc;

    uint256 public lastAmount;
    uint32 public lastDestinationDomain;
    bytes32 public lastMintRecipient;
    uint256 public lastMaxFee;
    uint32 public lastMinFinalityThreshold;
    bytes public lastHookData;
    uint256 public burnCalls;
    uint256 public hookBurnCalls;

    constructor(MockUSDC _usdc) {
        usdc = _usdc;
    }

    function depositForBurn(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32,
        uint256 maxFee,
        uint32 minFinalityThreshold
    ) external {
        burnCalls += 1;
        _record(amount, destinationDomain, mintRecipient, maxFee, minFinalityThreshold, "");
        usdc.transferFrom(msg.sender, address(this), amount);
        require(burnToken == address(usdc), "wrong burn token");
    }

    function depositForBurnWithHook(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32,
        uint256 maxFee,
        uint32 minFinalityThreshold,
        bytes calldata hookData
    ) external {
        hookBurnCalls += 1;
        _record(amount, destinationDomain, mintRecipient, maxFee, minFinalityThreshold, hookData);
        usdc.transferFrom(msg.sender, address(this), amount);
        require(burnToken == address(usdc), "wrong burn token");
    }

    function _record(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        uint256 maxFee,
        uint32 minFinalityThreshold,
        bytes memory hookData
    ) private {
        lastAmount = amount;
        lastDestinationDomain = destinationDomain;
        lastMintRecipient = mintRecipient;
        lastMaxFee = maxFee;
        lastMinFinalityThreshold = minFinalityThreshold;
        lastHookData = hookData;
    }
}

contract AgentTreasuryTest is Test {
    uint32 private constant ARC_TESTNET_DOMAIN = 26;
    uint32 private constant BASE_SEPOLIA_DOMAIN = 6;
    uint32 private constant FINALITY_STANDARD = 2000;

    address private owner = address(0xA11CE);
    address private executor = address(0xB0B);
    address private recipient = address(0xCAFE);
    address private stranger = address(0xDEAD);

    MockUSDC private usdc;
    MockTokenMessenger private messenger;
    AgentTreasuryFactory private factory;
    AgentTreasury private vault;

    /// @dev Vaults are always clones in production, so the suite exercises a clone rather than
    ///      a bare implementation — which `initialize` deliberately refuses.
    function setUp() public {
        usdc = new MockUSDC();
        messenger = new MockTokenMessenger(usdc);
        factory = new AgentTreasuryFactory(address(new AgentTreasury()), address(messenger));

        vm.prank(owner);
        vault = AgentTreasury(factory.createTreasury(executor, address(usdc)));
        usdc.mint(address(vault), 1_000e6);
    }

    // --- initialization and roles ---

    function testInitializeStoresRoles() public view {
        assertEq(vault.owner(), owner);
        assertEq(vault.executor(), executor);
        assertEq(address(vault.token()), address(usdc));
        assertEq(address(vault.tokenMessenger()), address(messenger));
        assertFalse(vault.paused());
    }

    function testImplementationIsLockedAgainstInitialize() public {
        AgentTreasury implementation = new AgentTreasury();
        vm.expectRevert("already initialized");
        implementation.initialize(owner, executor, address(usdc), address(messenger));
    }

    function testRejectsDoubleInitialize() public {
        vm.expectRevert("already initialized");
        vault.initialize(owner, executor, address(usdc), address(messenger));
    }

    function testOnlyExecutorCanPayout() public {
        vm.expectRevert("not executor");
        vault.payout(bytes32("req"), recipient, 10e6);

        vm.prank(owner);
        vm.expectRevert("not executor");
        vault.payout(bytes32("req"), recipient, 10e6);

        vm.prank(executor);
        vault.payout(bytes32("req"), recipient, 10e6);
        assertEq(usdc.balanceOf(recipient), 10e6);
    }

    function testExecutorCannotWithdrawOrAdminister() public {
        vm.startPrank(executor);
        vm.expectRevert("not owner");
        vault.withdraw(executor, 1e6);

        vm.expectRevert("not owner");
        vault.setPaused(true);

        vm.expectRevert("not owner");
        vault.setExecutor(stranger);

        vm.expectRevert("not owner");
        vault.setFeeReserveCap(1e6);
        vm.stopPrank();
    }

    function testOwnerCanRotateExecutor() public {
        vm.prank(owner);
        vault.setExecutor(stranger);
        assertEq(vault.executor(), stranger);

        vm.prank(executor);
        vm.expectRevert("not executor");
        vault.payout(bytes32("req"), recipient, 1e6);

        vm.prank(stranger);
        vault.payout(bytes32("req"), recipient, 1e6);
        assertEq(usdc.balanceOf(recipient), 1e6);
    }

    // --- payout guards ---

    function testRejectsZeroRecipientAndAmount() public {
        vm.startPrank(executor);
        vm.expectRevert("recipient zero");
        vault.payout(bytes32("a"), address(0), 1e6);

        vm.expectRevert("amount zero");
        vault.payout(bytes32("b"), recipient, 0);
        vm.stopPrank();
    }

    function testRequestCannotExecuteTwice() public {
        bytes32 requestId = bytes32("only-once");
        vm.prank(executor);
        vault.payout(requestId, recipient, 10e6);

        vm.prank(executor);
        vm.expectRevert("already executed");
        vault.payout(requestId, recipient, 10e6);
        assertEq(usdc.balanceOf(recipient), 10e6);
    }

    /// @dev The security property that matters most: one approved request cannot be both
    ///      settled locally and bridged, in either order.
    function testReplayProtectionIsSharedAcrossPayoutPaths() public {
        bytes32 requestId = bytes32("shared");
        _fundReserve(10e6);

        vm.prank(executor);
        vault.payout(requestId, recipient, 10e6);

        vm.prank(executor);
        vm.expectRevert("already executed");
        vault.payoutCrossChain(requestId, recipient, 10e6, BASE_SEPOLIA_DOMAIN, 1e6, FINALITY_STANDARD, "");

        bytes32 other = bytes32("shared-reverse");
        vm.prank(executor);
        vault.payoutCrossChain(other, recipient, 10e6, BASE_SEPOLIA_DOMAIN, 1e6, FINALITY_STANDARD, "");

        vm.prank(executor);
        vm.expectRevert("already executed");
        vault.payout(other, recipient, 10e6);
    }

    function testPayoutRejectsAmountAboveAvailableBalance() public {
        vm.prank(executor);
        vm.expectRevert("insufficient available balance");
        vault.payout(bytes32("too-big"), recipient, 1_001e6);
    }

    function testTransferFailureReverts() public {
        usdc.setFailTransfers(true);
        vm.prank(executor);
        vm.expectRevert("transfer failed");
        vault.payout(bytes32("req"), recipient, 10e6);
    }

    // --- pause ---

    function testPauseBlocksBothPayoutPathsButNotWithdraw() public {
        _fundReserve(5e6);
        vm.prank(owner);
        vault.setPaused(true);
        assertTrue(vault.paused());

        vm.prank(executor);
        vm.expectRevert("paused");
        vault.payout(bytes32("p"), recipient, 10e6);

        vm.prank(executor);
        vm.expectRevert("paused");
        vault.payoutCrossChain(bytes32("q"), recipient, 10e6, BASE_SEPOLIA_DOMAIN, 1e6, FINALITY_STANDARD, "");

        // The owner escape hatch stays open while paused.
        vm.prank(owner);
        vault.withdraw(owner, 25e6);
        assertEq(usdc.balanceOf(owner), 25e6);

        vm.prank(owner);
        vault.setPaused(false);
        vm.prank(executor);
        vault.payout(bytes32("p"), recipient, 10e6);
        assertEq(usdc.balanceOf(recipient), 10e6);
    }

    // --- fee reserve ---

    function testFeeReserveIsExcludedFromPayoutPrincipal() public {
        _fundReserve(100e6);
        assertEq(vault.feeReserve(), 100e6);
        assertEq(vault.availableBalance(), 900e6);

        vm.prank(executor);
        vm.expectRevert("insufficient available balance");
        vault.payout(bytes32("eats-reserve"), recipient, 901e6);

        vm.prank(executor);
        vault.payout(bytes32("fits"), recipient, 900e6);
        assertEq(vault.availableBalance(), 0);
        assertEq(vault.feeReserve(), 100e6);
    }

    function testFeeReserveRespectsCap() public {
        vm.startPrank(owner);
        vault.setFeeReserveCap(50e6);

        vm.expectRevert("exceeds reserve cap");
        vault.fundFeeReserve(51e6);

        vault.fundFeeReserve(50e6);
        assertEq(vault.feeReserve(), 50e6);

        vm.expectRevert("exceeds reserve cap");
        vault.fundFeeReserve(1);

        vm.expectRevert("cap below reserve");
        vault.setFeeReserveCap(49e6);
        vm.stopPrank();
    }

    function testFeeReserveCannotExceedUnreservedBalance() public {
        vm.startPrank(owner);
        vault.setFeeReserveCap(5_000e6);
        vm.expectRevert("insufficient unreserved balance");
        vault.fundFeeReserve(1_001e6);
        vm.stopPrank();
    }

    function testOwnerCanReleaseFeeReserve() public {
        _fundReserve(40e6);
        vm.startPrank(owner);
        vm.expectRevert("insufficient fee reserve");
        vault.releaseFeeReserve(41e6);

        vault.releaseFeeReserve(40e6);
        assertEq(vault.feeReserve(), 0);
        assertEq(vault.availableBalance(), 1_000e6);
        vm.stopPrank();
    }

    function testWithdrawShrinksReserveToRemainingBalance() public {
        _fundReserve(100e6);
        vm.prank(owner);
        vault.withdraw(owner, 950e6);

        // 50 USDC left in the vault cannot back a 100 USDC reserve.
        assertEq(vault.feeReserve(), 50e6);
        assertEq(vault.availableBalance(), 0);
    }

    /// @dev On Arc the ERC-20 interface is a view onto the native USDC balance, so `withdraw` is
    ///      the vault's only exit and the reserve cannot be drained around it. A bare native send
    ///      must revert, since the vault declares no receive or fallback.
    function testVaultRejectsBareNativeSend() public {
        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        (bool sent,) = address(vault).call{value: 1 ether}("");
        assertFalse(sent);
    }

    function testWithdrawCanDrainEntireBalanceIncludingReserve() public {
        _fundReserve(100e6);
        vm.prank(owner);
        vault.withdraw(owner, 1_000e6);

        assertEq(usdc.balanceOf(address(vault)), 0);
        assertEq(vault.feeReserve(), 0);
        assertEq(vault.availableBalance(), 0);
        assertEq(usdc.balanceOf(owner), 1_000e6);
    }

    // --- cross-chain settlement ---

    function testPayoutCrossChainBurnsPrincipalPlusFee() public {
        _fundReserve(10e6);

        vm.prank(executor);
        vault.payoutCrossChain(bytes32("x"), recipient, 100e6, BASE_SEPOLIA_DOMAIN, 2e6, FINALITY_STANDARD, "");

        // CCTP deducts its fee from the burn, so principal + maxFee must be burned.
        assertEq(messenger.lastAmount(), 102e6);
        assertEq(messenger.lastMaxFee(), 2e6);
        assertEq(uint256(messenger.lastDestinationDomain()), uint256(BASE_SEPOLIA_DOMAIN));
        assertEq(uint256(messenger.lastMinFinalityThreshold()), uint256(FINALITY_STANDARD));
        assertEq(messenger.lastMintRecipient(), bytes32(uint256(uint160(recipient))));
        assertEq(messenger.burnCalls(), 1);
        assertEq(messenger.hookBurnCalls(), 0);

        // The fee came out of the reserve, not the principal.
        assertEq(vault.feeReserve(), 8e6);
        assertEq(usdc.balanceOf(address(vault)), 898e6);
    }

    function testPayoutCrossChainUsesHookWhenForwarding() public {
        _fundReserve(10e6);
        bytes memory hookData = hex"c0ffee";

        vm.prank(executor);
        vault.payoutCrossChain(bytes32("f"), recipient, 50e6, ARC_TESTNET_DOMAIN, 1e6, FINALITY_STANDARD, hookData);

        assertEq(messenger.hookBurnCalls(), 1);
        assertEq(messenger.burnCalls(), 0);
        assertEq(messenger.lastHookData(), hookData);
        assertEq(messenger.lastAmount(), 51e6);
    }

    function testPayoutCrossChainRequiresFeeReserve() public {
        vm.prank(executor);
        vm.expectRevert("insufficient fee reserve");
        vault.payoutCrossChain(bytes32("nofee"), recipient, 10e6, BASE_SEPOLIA_DOMAIN, 1e6, FINALITY_STANDARD, "");
    }

    function testPayoutCrossChainRequiresMessenger() public {
        vm.prank(owner);
        vault.setTokenMessenger(address(0));

        _fundReserve(5e6);
        vm.prank(executor);
        vm.expectRevert("messenger unset");
        vault.payoutCrossChain(bytes32("nm"), recipient, 10e6, BASE_SEPOLIA_DOMAIN, 1e6, FINALITY_STANDARD, "");
    }

    function testPayoutCrossChainIsExecutorOnly() public {
        _fundReserve(5e6);
        vm.prank(owner);
        vm.expectRevert("not executor");
        vault.payoutCrossChain(bytes32("auth"), recipient, 10e6, BASE_SEPOLIA_DOMAIN, 1e6, FINALITY_STANDARD, "");
    }

    function testApprovalFailureReverts() public {
        _fundReserve(5e6);
        usdc.setFailApprovals(true);
        vm.prank(executor);
        vm.expectRevert("approve failed");
        vault.payoutCrossChain(bytes32("ap"), recipient, 10e6, BASE_SEPOLIA_DOMAIN, 1e6, FINALITY_STANDARD, "");
    }

    // --- factory ---

    function testFactoryCreatesInitializedClone() public {
        vm.prank(stranger);
        address clone = factory.createTreasury(executor, address(usdc));

        AgentTreasury created = AgentTreasury(clone);
        assertEq(created.owner(), stranger);
        assertEq(created.executor(), executor);
        assertEq(address(created.token()), address(usdc));
        assertEq(address(created.tokenMessenger()), address(messenger));
        assertEq(created.feeReserve(), 0);
        assertFalse(created.paused());
    }

    function testFactoryClonesAreIsolated() public {
        vm.prank(owner);
        address first = factory.createTreasury(executor, address(usdc));
        vm.prank(stranger);
        address second = factory.createTreasury(executor, address(usdc));

        assertTrue(first != second);
        assertEq(AgentTreasury(first).owner(), owner);
        assertEq(AgentTreasury(second).owner(), stranger);

        // A clone's replay state must not leak into its sibling.
        usdc.mint(first, 100e6);
        usdc.mint(second, 100e6);
        bytes32 requestId = bytes32("per-vault");

        vm.prank(executor);
        AgentTreasury(first).payout(requestId, recipient, 10e6);
        assertTrue(AgentTreasury(first).executed(requestId));
        assertFalse(AgentTreasury(second).executed(requestId));

        vm.prank(executor);
        AgentTreasury(second).payout(requestId, recipient, 10e6);
        assertEq(usdc.balanceOf(recipient), 20e6);
    }

    function _fundReserve(uint256 amount) private {
        vm.startPrank(owner);
        vault.setFeeReserveCap(amount);
        vault.fundFeeReserve(amount);
        vm.stopPrank();
    }
}
