// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

/// @title IAtlasTicket
/// @notice External interface for the ATLAS Stage 2 AtlasTicket NFT contract (v2 — burn flow +
///         custodial-wallet pattern). Declares the custom errors, the canonical mint, burn, and
///         custodial-wallet events, and the read-only views integrators rely on.
interface IAtlasTicket {
    /// @notice Emitted when a ticket is successfully minted.
    /// @param tokenId The ERC-721 token id assigned to the new ticket.
    /// @param to The address that receives the freshly minted ticket.
    /// @param eventId The off-chain event identifier the ticket belongs to.
    /// @param paymentId The unique payment identifier the mint is keyed against.
    /// @param tokenURI The token URI (typically an IPFS CID) describing the ticket.
    /// @param emailHash keccak256 of the buyer's lowercase email, or `bytes32(0)` when the
    ///                  recipient supplied a self-custody wallet at purchase time. Powers the
    ///                  custodial-wallet → claimed-wallet handoff for email-only buyers.
    event TicketMinted(
        uint256 indexed tokenId,
        address indexed to,
        uint256 indexed eventId,
        bytes32 paymentId,
        string tokenURI,
        bytes32 emailHash
    );

    /// @notice Emitted when a ticket is burned via {burn}, typically as part of a refund flow.
    /// @param tokenId The ERC-721 token id that was burned.
    /// @param paymentId The paymentId originally associated with the burned ticket. Lets
    ///                  off-chain consumers correlate the burn with the FeeRouter refund.
    event TicketBurned(uint256 indexed tokenId, bytes32 indexed paymentId);

    /// @notice Reverts when an address argument is the zero address.
    error ZeroAddress();

    /// @notice Reverts when mint() is called twice for the same paymentId.
    /// @param paymentId The duplicate payment identifier.
    /// @param existingTokenId The token id that was already minted for this payment.
    error PaymentAlreadyMinted(bytes32 paymentId, uint256 existingTokenId);

    /// @notice Reverts when mint() is called with an empty token URI.
    error EmptyTokenURI();

    /// @notice Reverts when a view, transfer, or burn touches a token id that does not exist.
    /// @param tokenId The unminted (or already-burned) token id queried.
    error TokenNotMinted(uint256 tokenId);

    /// @notice Returns the paymentId stored for a minted ticket.
    /// @param tokenId The ERC-721 token id to query.
    function paymentIdOf(uint256 tokenId) external view returns (bytes32);

    /// @notice Returns the eventId stored for a minted ticket.
    /// @param tokenId The ERC-721 token id to query.
    function eventIdOf(uint256 tokenId) external view returns (uint256);

    /// @notice Returns the buyer email hash stored for a minted ticket. Returns `bytes32(0)` for
    ///         tickets minted directly to a self-custody wallet (no email-only flow).
    /// @param tokenId The ERC-721 token id to query.
    function emailHashOf(uint256 tokenId) external view returns (bytes32);

    /// @notice Burn a ticket. Only callable by an account holding BURNER_ROLE. Used by the
    ///         settlement service when reversing a payment via FeeRouter.reverseSettle().
    /// @param tokenId The ERC-721 token id to burn.
    /// @param paymentId The paymentId associated with the ticket; emitted in TicketBurned so
    ///                  off-chain consumers can correlate the burn with the original payment.
    function burn(uint256 tokenId, bytes32 paymentId) external;
}
