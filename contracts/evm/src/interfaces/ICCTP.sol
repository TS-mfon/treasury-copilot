// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal ERC-20 surface used by the Arc agent treasury.
/// @dev On Arc the canonical USDC ERC-20 interface lives at
///      0x3600000000000000000000000000000000000000 and reports 6 decimals, matching Base.
///      Arc's *native* USDC gas asset uses 18 decimals and is never routed through this interface.
interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

/// @notice Circle CCTP V2 burn entrypoint.
/// @dev Deployed at the same address on every supported chain:
///      testnet 0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA,
///      mainnet 0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d.
interface ITokenMessengerV2 {
    /// @param mintRecipient Left-padded destination address.
    /// @param destinationCaller Left-padded address permitted to call receiveMessage, or zero for any.
    /// @param maxFee Upper bound on the CCTP fee deducted from `amount` before the destination mint.
    function depositForBurn(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold
    ) external;

    /// @notice Burn variant carrying hook data, used for Circle's Forwarding Service.
    function depositForBurnWithHook(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold,
        bytes calldata hookData
    ) external;
}

/// @notice Circle CCTP V2 destination-side mint entrypoint.
/// @dev Only needed for the direct-mint strategy. Forwarded transfers are minted by Circle.
interface IMessageTransmitterV2 {
    function receiveMessage(bytes calldata message, bytes calldata attestation) external returns (bool);
}
