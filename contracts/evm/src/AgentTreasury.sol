// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20, ITokenMessengerV2} from "./interfaces/ICCTP.sol";

/// @notice Clone-safe reentrancy guard.
/// @dev Clones start with zero storage, so NOT_ENTERED is never written at construction.
///      The check tests inequality against ENTERED so an uninitialized zero slot is treated
///      as not entered.
contract ReentrancyGuard {
    uint256 private constant NOT_ENTERED = 1;
    uint256 private constant ENTERED = 2;
    uint256 private status;

    modifier nonReentrant() {
        require(status != ENTERED, "reentrant");
        status = ENTERED;
        _;
        status = NOT_ENTERED;
    }
}

/// @title AgentTreasury
/// @notice Arc-native USDC vault that settles GenLayer-approved agent payments.
/// @dev Deployed as a minimal-proxy clone, one vault per owner, by AgentTreasuryFactory.
///
///      Treasury Copilot's Base and Arbitrum settlement path redelegates an owner's ERC-7715
///      MetaMask permission to the 1Shot relayer and holds no contract of its own. Arc has
///      neither the MetaMask Delegation Framework nor 1Shot support, so Arc settles through
///      this vault with a dedicated platform executor instead.
///
///      Authority is split: `owner` is the human wallet and can withdraw, pause, and rotate the
///      executor; `executor` is the platform's Arc signer and can only pay out requests GenLayer
///      has already approved. The executor can never withdraw, and a paused vault can never pay.
///
///      Arc balance model: the USDC ERC-20 interface is a *view onto the native USDC balance*,
///      not a separate token. Verified on Arc Testnet, `balanceOf` and `eth_getBalance` for the
///      same account differ by exactly 1e12 (6 vs 18 decimals). The vault therefore needs no
///      native-asset rescue path -- `withdraw` through the ERC-20 interface already reaches every
///      unit the vault holds, and it is the only exit, so `feeReserve` can never be desynced by
///      a second withdrawal route. The absence of `receive`/`fallback` is deliberate: funding
///      arrives as an ERC-20 transfer or a CCTP mint, and a bare native send reverts.
contract AgentTreasury is ReentrancyGuard {
    address public owner;
    address public executor;
    IERC20 public token;
    ITokenMessengerV2 public tokenMessenger;

    /// @notice Replay protection shared by both payout paths, keyed by GenLayer request id.
    /// @dev A request can therefore never be both paid locally and bridged.
    mapping(bytes32 => bool) public executed;

    /// @notice USDC earmarked to cover CCTP fees, excluded from payout principal.
    uint256 public feeReserve;
    /// @notice Upper bound on `feeReserve`, keeping the reserve bounded as the roadmap requires.
    uint256 public feeReserveCap;

    bool public paused;
    bool private initialized;

    event Initialized(address indexed owner, address indexed executor, address token);
    event Executed(bytes32 indexed requestId, address indexed recipient, uint256 amount, uint256 timestamp);
    event CrossChainInitiated(
        bytes32 indexed requestId,
        uint32 indexed destinationDomain,
        address indexed recipient,
        uint256 amount,
        uint256 maxFee,
        bool forwarded,
        uint256 timestamp
    );
    event Withdrawn(address indexed recipient, uint256 amount);
    event ExecutorUpdated(address indexed newExecutor);
    event TokenMessengerUpdated(address indexed newTokenMessenger);
    event FeeReserveFunded(uint256 amount, uint256 total);
    event FeeReserveReleased(uint256 amount, uint256 total);
    event FeeReserveCapUpdated(uint256 cap);
    event PausedSet(address indexed by, bool paused);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier onlyExecutor() {
        require(msg.sender == executor, "not executor");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "paused");
        _;
    }

    /// @dev Locks the implementation against direct initialization. Clones carry their own
    ///      zeroed storage and so remain initializable exactly once.
    constructor() {
        initialized = true;
    }

    function initialize(address _owner, address _executor, address _token, address _tokenMessenger) external {
        require(!initialized, "already initialized");
        require(_owner != address(0), "owner zero");
        require(_executor != address(0), "executor zero");
        require(_token != address(0), "token zero");

        initialized = true;
        owner = _owner;
        executor = _executor;
        token = IERC20(_token);
        tokenMessenger = ITokenMessengerV2(_tokenMessenger);
        emit Initialized(_owner, _executor, _token);
    }

    /// @notice Vault balance usable as payout principal, excluding the earmarked fee reserve.
    function availableBalance() public view returns (uint256) {
        uint256 balance = token.balanceOf(address(this));
        return balance > feeReserve ? balance - feeReserve : 0;
    }

    /// @notice Settle an approved request on this chain.
    function payout(bytes32 requestId, address recipient, uint256 amount)
        external
        onlyExecutor
        whenNotPaused
        nonReentrant
    {
        require(recipient != address(0), "recipient zero");
        require(amount > 0, "amount zero");
        require(!executed[requestId], "already executed");
        require(availableBalance() >= amount, "insufficient available balance");

        executed[requestId] = true;
        require(token.transfer(recipient, amount), "transfer failed");
        emit Executed(requestId, recipient, amount, block.timestamp);
    }

    /// @notice Settle an approved request on another chain by burning USDC through CCTP V2.
    /// @dev CCTP deducts its fee from the burned amount, so `amount + maxFee` is burned to make
    ///      the recipient whole. Principal comes from `availableBalance()`; the fee comes from
    ///      `feeReserve`. Passing non-empty `hookData` routes through Circle's Forwarding
    ///      Service, which performs the destination mint so Treasury Copilot needs no executor
    ///      or gas balance on the destination chain.
    function payoutCrossChain(
        bytes32 requestId,
        address recipient,
        uint256 amount,
        uint32 destinationDomain,
        uint256 maxFee,
        uint32 minFinalityThreshold,
        bytes calldata hookData
    ) external onlyExecutor whenNotPaused nonReentrant {
        require(recipient != address(0), "recipient zero");
        require(amount > 0, "amount zero");
        require(!executed[requestId], "already executed");
        require(address(tokenMessenger) != address(0), "messenger unset");
        require(availableBalance() >= amount, "insufficient available balance");
        require(feeReserve >= maxFee, "insufficient fee reserve");

        executed[requestId] = true;
        feeReserve -= maxFee;

        uint256 total = amount + maxFee;
        require(token.approve(address(tokenMessenger), total), "approve failed");

        bytes32 mintRecipient = bytes32(uint256(uint160(recipient)));
        bool forwarded = hookData.length > 0;
        if (forwarded) {
            tokenMessenger.depositForBurnWithHook(
                total,
                destinationDomain,
                mintRecipient,
                address(token),
                bytes32(0),
                maxFee,
                minFinalityThreshold,
                hookData
            );
        } else {
            tokenMessenger.depositForBurn(
                total,
                destinationDomain,
                mintRecipient,
                address(token),
                bytes32(0),
                maxFee,
                minFinalityThreshold
            );
        }

        emit CrossChainInitiated(
            requestId, destinationDomain, recipient, amount, maxFee, forwarded, block.timestamp
        );
    }

    /// @notice Owner escape hatch. Deliberately available while paused.
    /// @dev This is the vault's only exit. On Arc the ERC-20 interface covers the entire native
    ///      USDC balance, so no separate native-rescue function is needed or wanted.
    function withdraw(address recipient, uint256 amount) external onlyOwner nonReentrant {
        require(recipient != address(0), "recipient zero");
        require(amount > 0, "amount zero");
        uint256 balance = token.balanceOf(address(this));
        require(balance >= amount, "insufficient balance");

        // Withdrawing into the reserve shrinks it to whatever balance remains, so the
        // accounting can never claim to reserve more USDC than the vault holds.
        uint256 remaining = balance - amount;
        if (feeReserve > remaining) {
            feeReserve = remaining;
        }
        require(token.transfer(recipient, amount), "transfer failed");
        emit Withdrawn(recipient, amount);
    }

    function fundFeeReserve(uint256 amount) external onlyOwner {
        require(amount > 0, "amount zero");
        require(feeReserve + amount <= feeReserveCap, "exceeds reserve cap");
        require(availableBalance() >= amount, "insufficient unreserved balance");
        feeReserve += amount;
        emit FeeReserveFunded(amount, feeReserve);
    }

    function releaseFeeReserve(uint256 amount) external onlyOwner {
        require(amount > 0, "amount zero");
        require(feeReserve >= amount, "insufficient fee reserve");
        feeReserve -= amount;
        emit FeeReserveReleased(amount, feeReserve);
    }

    function setFeeReserveCap(uint256 cap) external onlyOwner {
        require(cap >= feeReserve, "cap below reserve");
        feeReserveCap = cap;
        emit FeeReserveCapUpdated(cap);
    }

    function setExecutor(address _executor) external onlyOwner {
        require(_executor != address(0), "executor zero");
        executor = _executor;
        emit ExecutorUpdated(_executor);
    }

    function setTokenMessenger(address _tokenMessenger) external onlyOwner {
        tokenMessenger = ITokenMessengerV2(_tokenMessenger);
        emit TokenMessengerUpdated(_tokenMessenger);
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit PausedSet(msg.sender, _paused);
    }
}
