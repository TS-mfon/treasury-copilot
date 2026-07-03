// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
}

contract ReentrancyGuard {
    uint256 private constant NOT_ENTERED = 1;
    uint256 private constant ENTERED = 2;
    uint256 private status;

    constructor() {
        status = NOT_ENTERED;
    }

    modifier nonReentrant() {
        require(status != ENTERED, "reentrant");
        status = ENTERED;
        _;
        status = NOT_ENTERED;
    }
}

contract Treasury is ReentrancyGuard {
    address public owner;
    address public relayer;
    address public authorizedAgent;
    IERC20 public token;
    bool private initialized;

    event Funded(address indexed from, uint256 amount);
    event Executed(bytes32 indexed requestId, address indexed recipient, uint256 amount, uint256 timestamp);
    event RelayerUpdated(address indexed newRelayer);
    event AuthorizedAgentUpdated(address indexed newAuthorizedAgent);
    event Withdrawn(address indexed recipient, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier onlyRelayer() {
        require(msg.sender == relayer, "not relayer");
        _;
    }

    function initialize(address _owner, address _relayer, address _token) external {
        require(!initialized, "already initialized");
        require(_owner != address(0), "owner zero");
        require(_relayer != address(0), "relayer zero");
        require(_token != address(0), "token zero");

        initialized = true;
        owner = _owner;
        relayer = _relayer;
        authorizedAgent = _relayer;
        token = IERC20(_token);
    }

    function payout(bytes32 requestId, address recipient, uint256 amount) external onlyRelayer nonReentrant {
        require(recipient != address(0), "recipient zero");
        require(amount > 0, "amount zero");
        require(token.transfer(recipient, amount), "transfer failed");
        emit Executed(requestId, recipient, amount, block.timestamp);
    }

    function withdraw(address recipient, uint256 amount) external onlyOwner nonReentrant {
        require(recipient != address(0), "recipient zero");
        require(amount > 0, "amount zero");
        require(token.transfer(recipient, amount), "transfer failed");
        emit Withdrawn(recipient, amount);
    }

    function setRelayer(address _relayer) external onlyOwner {
        require(_relayer != address(0), "relayer zero");
        relayer = _relayer;
        emit RelayerUpdated(_relayer);
    }

    function setAuthorizedAgent(address _authorizedAgent) external onlyOwner {
        require(_authorizedAgent != address(0), "agent zero");
        authorizedAgent = _authorizedAgent;
        emit AuthorizedAgentUpdated(_authorizedAgent);
    }

    function notifyFunded(uint256 amount) external {
        emit Funded(msg.sender, amount);
    }
}
