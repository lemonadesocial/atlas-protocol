// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

/// @title IFeeRouter
/// @notice External interface for the ATLAS FeeRouter (v2 — stacked platform fees + refund flow).
interface IFeeRouter {
    /// @notice A single platform-fee leg in a stacked settlement.
    /// @dev Multiple platforms (Lemonade, partners, etc.) can each take a cut on top of the
    ///      protocol fee. The sum of all platform fees is capped by MAX_TOTAL_PLATFORM_FEES_BPS.
    struct FeeSplit {
        address recipient;
        uint256 amount;
    }

    /// @notice Emitted when a payment is settled and split between organizer, treasury, and
    ///         zero or more platform fee recipients.
    event PaymentSettled(
        bytes32 indexed paymentId,
        address indexed organizer,
        uint256 totalAmount,
        uint256 organizerAmount,
        uint256 protocolFee,
        FeeSplit[] platformFees
    );

    /// @notice Emitted when a settled payment is reversed (refunded). `feesReversed` lists which
    ///         platform-fee legs were pulled back from their recipients; any platform fee not in
    ///         the array is retained by its recipient and funded by `msg.sender` instead.
    event PaymentReversed(
        bytes32 indexed paymentId,
        address indexed buyer,
        uint256 refundAmount,
        FeeSplit[] feesReversed
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

    /// @notice Reverts when the sum of platform fees exceeds MAX_TOTAL_PLATFORM_FEES_BPS.
    error PlatformFeesAboveCap();

    /// @notice Reverts when the organizer share would fall below MIN_ORGANIZER_BPS.
    error OrganizerShareBelowFloor();

    /// @notice Reverts when reverseSettle is called for a paymentId that was never settled.
    error PaymentNotSettled(bytes32 paymentId);

    /// @notice Reverts when reverseSettle is called twice for the same paymentId.
    error PaymentAlreadyRefunded(bytes32 paymentId);

    /// @notice Reverts when the sum of fees being reversed exceeds the refund amount.
    error RefundAmountInvalid();

    /// @notice Settle a payment, splitting it between organizer, treasury, and platform fees.
    /// @param organizer Recipient of the organizer share.
    /// @param totalAmount Gross stablecoin amount pulled from `msg.sender`.
    /// @param paymentId Unique payment identifier; reverts on re-use.
    /// @param platformFees Array of platform-fee legs taken on top of the protocol fee.
    function settle(
        address organizer,
        uint256 totalAmount,
        bytes32 paymentId,
        FeeSplit[] calldata platformFees
    ) external;

    /// @notice Reverse a previously settled payment by refunding `refundAmount` to `buyer`.
    /// @dev `feesToReverse` lists which platform-fee recipients are required to return their
    ///      cut. Each listed recipient must have pre-approved this contract to pull
    ///      `feesToReverse[i].amount` of stablecoin. The caller (`msg.sender`) supplies the
    ///      remainder, i.e. `refundAmount - sum(feesToReverse[i].amount)`.
    function reverseSettle(
        bytes32 paymentId,
        address buyer,
        uint256 refundAmount,
        FeeSplit[] calldata feesToReverse
    ) external;

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

    /// @notice The ERC-20 stablecoin token address used for settlements on this chain.
    function stablecoin() external view returns (address);

    /// @notice Returns true if the given paymentId has already been settled.
    function isSettled(bytes32 paymentId) external view returns (bool);

    /// @notice Returns true if the given paymentId has already been refunded.
    function isRefunded(bytes32 paymentId) external view returns (bool);
}
