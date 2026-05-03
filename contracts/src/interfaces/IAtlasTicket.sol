// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

/// @title IAtlasTicket
/// @notice External interface for the ATLAS Stage 2 AtlasTicket NFT contract.
///         Declares the custom errors, the canonical mint event, and the
///         read-only views integrators rely on.
interface IAtlasTicket {
    /// @notice Emitted when a ticket is successfully minted.
    /// @param tokenId The ERC-721 token id assigned to the new ticket.
    /// @param to The address that receives the freshly minted ticket.
    /// @param eventId The off-chain event identifier the ticket belongs to.
    /// @param paymentId The unique payment identifier the mint is keyed against.
    /// @param tokenURI The token URI (typically an IPFS CID) describing the ticket.
    event TicketMinted(
        uint256 indexed tokenId, address indexed to, uint256 indexed eventId, bytes32 paymentId, string tokenURI
    );

    /// @notice Reverts when an address argument is the zero address.
    error ZeroAddress();

    /// @notice Reverts when mint() is called twice for the same paymentId.
    /// @param paymentId The duplicate payment identifier.
    /// @param existingTokenId The token id that was already minted for this payment.
    error PaymentAlreadyMinted(bytes32 paymentId, uint256 existingTokenId);

    /// @notice Reverts when mint() is called with an empty token URI.
    error EmptyTokenURI();

    /// @notice Reverts when a view is called for a token id that does not exist.
    /// @param tokenId The unminted token id queried.
    error TokenNotMinted(uint256 tokenId);

    /// @notice Returns the paymentId stored for a minted ticket.
    /// @param tokenId The ERC-721 token id to query.
    function paymentIdOf(uint256 tokenId) external view returns (bytes32);

    /// @notice Returns the eventId stored for a minted ticket.
    /// @param tokenId The ERC-721 token id to query.
    function eventIdOf(uint256 tokenId) external view returns (uint256);
}
