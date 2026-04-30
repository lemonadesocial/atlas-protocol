// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

/// @title IFeeRouter
/// @notice External interface for the ATLAS Stage 1 FeeRouter.
interface IFeeRouter {
    /// @notice Emitted when a payment is settled and split between organizer and treasury.
    event PaymentSettled(
        bytes32 indexed paymentId, address indexed organizer, uint256 organizerAmount, uint256 protocolFee
    );

    /// @notice Emitted when the protocol fee schedule is updated.
    event FeeScheduleUpdated(uint16 oldBps, uint16 newBps);

    /// @notice Emitted when the treasury address is updated.
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);

    /// @notice Reverts when an amount of zero is supplied.
    error ZeroAmount();

    /// @notice Reverts when an address argument is the zero address.
    error ZeroAddress();

    /// @notice Reverts when settle() is called twice for the same paymentId.
    error PaymentAlreadySettled(bytes32 paymentId);

    /// @notice Reverts when the new fee bps would exceed the hard cap.
    error FeeBpsTooHigh(uint16 bps, uint16 maxBps);

    /// @notice Settle a payment, splitting it between organizer and treasury.
    function settle(address organizer, uint256 amount, bytes32 paymentId) external;

    /// @notice Update the protocol fee in basis points.
    function setFeeBps(uint16 newBps) external;

    /// @notice Update the treasury address.
    function setTreasury(address newTreasury) external;

    /// @notice Pause settle().
    function pause() external;

    /// @notice Unpause settle().
    function unpause() external;

    /// @notice Current protocol fee in basis points.
    function feeBps() external view returns (uint16);

    /// @notice Current treasury address.
    function treasury() external view returns (address);

    /// @notice The USDC token address used for settlements.
    function usdc() external view returns (address);

    /// @notice Returns true if the given paymentId has already been settled.
    function isSettled(bytes32 paymentId) external view returns (bool);
}
