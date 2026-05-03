// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import { ERC721Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import { ERC721PausableUpgradeable } from
    "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/ERC721PausableUpgradeable.sol";

import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

import { IAtlasTicket } from "./interfaces/IAtlasTicket.sol";

/// @title AtlasTicket
/// @notice Stage 2 ATLAS NFT ticket. Each token represents one purchased ticket and is keyed
///         by an off-chain `paymentId` so mints are idempotent: a second mint attempt for the
///         same paymentId reverts with the existing tokenId. Pausable transfers and mints,
///         UUPS-upgradeable, role-gated. The (name, symbol) pair is supplied at initialization
///         time so the contract is portable across operators and chains.
contract AtlasTicket is
    Initializable,
    UUPSUpgradeable,
    AccessControlUpgradeable,
    ERC721Upgradeable,
    ERC721PausableUpgradeable,
    ReentrancyGuardTransient,
    IAtlasTicket
{
    /// @notice Role permitted to mint new tickets.
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    /// @notice Role permitted to pause and unpause ticket transfers and mints.
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// @notice Role permitted to upgrade the implementation.
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    /// @dev Next tokenId to assign. Initialized to 1 so tokenId == 0 is reserved as "no token".
    uint256 private _nextTokenId;

    /// @dev tokenId → token URI (typically an IPFS CID describing the ticket payload).
    mapping(uint256 => string) private _tokenURIs;

    /// @dev tokenId → off-chain event identifier the ticket belongs to.
    mapping(uint256 => uint256) private _eventIds;

    /// @dev tokenId → unique payment identifier the mint was keyed against.
    mapping(uint256 => bytes32) private _paymentIds;

    /// @dev paymentId → tokenId (0 = not minted). Powers idempotent mint().
    mapping(bytes32 => uint256) private _tokenIdByPayment;

    /// @dev Reserves storage to total of 50 slots for upgrade-safety. See OZ upgradeable docs.
    uint256[45] private __gap;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initialize the AtlasTicket NFT.
    /// @param admin Receives DEFAULT_ADMIN_ROLE.
    /// @param minter Receives MINTER_ROLE.
    /// @param pauser Receives PAUSER_ROLE.
    /// @param upgrader Receives UPGRADER_ROLE.
    /// @param name_ ERC-721 collection name (e.g. "ATLAS Ticket").
    /// @param symbol_ ERC-721 collection symbol (e.g. "ATLAS").
    function initialize(
        address admin,
        address minter,
        address pauser,
        address upgrader,
        string memory name_,
        string memory symbol_
    ) external initializer {
        if (admin == address(0)) revert ZeroAddress();
        if (minter == address(0)) revert ZeroAddress();
        if (pauser == address(0)) revert ZeroAddress();
        if (upgrader == address(0)) revert ZeroAddress();

        __ERC721_init(name_, symbol_);
        __AccessControl_init();
        __Pausable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, minter);
        _grantRole(PAUSER_ROLE, pauser);
        _grantRole(UPGRADER_ROLE, upgrader);

        _nextTokenId = 1;
    }

    // ---------------------------------------------------------------------
    // External
    // ---------------------------------------------------------------------

    /// @notice Mint a ticket NFT to `to`, idempotent per `paymentId`.
    /// @dev Reverts ZeroAddress if `to` is zero, EmptyTokenURI if the URI is empty, and
    ///      PaymentAlreadyMinted with the existing tokenId if `paymentId` was already used.
    ///      Pause-gated via the inherited ERC721Pausable `_update` hook.
    /// @param to Recipient of the freshly minted ticket.
    /// @param eventId Off-chain event identifier this ticket belongs to.
    /// @param paymentId Unique payment identifier; second mint with the same value reverts.
    /// @param tokenURI_ Token URI (typically an IPFS CID).
    /// @return tokenId The newly assigned ERC-721 token id.
    function mint(address to, uint256 eventId, bytes32 paymentId, string calldata tokenURI_)
        external
        onlyRole(MINTER_ROLE)
        nonReentrant
        whenNotPaused
        returns (uint256 tokenId)
    {
        if (to == address(0)) revert ZeroAddress();
        if (bytes(tokenURI_).length == 0) revert EmptyTokenURI();
        uint256 existing = _tokenIdByPayment[paymentId];
        if (existing != 0) revert PaymentAlreadyMinted(paymentId, existing);

        // Effects: assign id and record metadata before any external interaction.
        tokenId = _nextTokenId;
        unchecked {
            _nextTokenId = tokenId + 1;
        }

        _tokenURIs[tokenId] = tokenURI_;
        _eventIds[tokenId] = eventId;
        _paymentIds[tokenId] = paymentId;
        _tokenIdByPayment[paymentId] = tokenId;

        // Interactions: _safeMint will call onERC721Received on contract recipients.
        _safeMint(to, tokenId);

        emit TicketMinted(tokenId, to, eventId, paymentId, tokenURI_);
    }

    /// @notice Pause mints and transfers.
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /// @notice Unpause mints and transfers.
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @notice ERC-721 metadata URI for `tokenId`.
    /// @dev Reverts TokenNotMinted instead of OpenZeppelin's default ERC721NonexistentToken so
    ///      ATLAS integrators can decode a single, contract-defined error selector.
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        if (_ownerOf(tokenId) == address(0)) revert TokenNotMinted(tokenId);
        return _tokenURIs[tokenId];
    }

    /// @inheritdoc IAtlasTicket
    function paymentIdOf(uint256 tokenId) external view override returns (bytes32) {
        if (_ownerOf(tokenId) == address(0)) revert TokenNotMinted(tokenId);
        return _paymentIds[tokenId];
    }

    /// @inheritdoc IAtlasTicket
    function eventIdOf(uint256 tokenId) external view override returns (uint256) {
        if (_ownerOf(tokenId) == address(0)) revert TokenNotMinted(tokenId);
        return _eventIds[tokenId];
    }

    // ---------------------------------------------------------------------
    // Internal overrides (multiple-inheritance resolution)
    // ---------------------------------------------------------------------

    /// @dev Resolves the ERC721 / ERC721Pausable diamond. ERC721Pausable's whenNotPaused
    ///      guard runs via super, so transfers and mints both honor the pause flag.
    function _update(address to, uint256 tokenId, address auth)
        internal
        override(ERC721Upgradeable, ERC721PausableUpgradeable)
        returns (address)
    {
        return super._update(to, tokenId, auth);
    }

    /// @inheritdoc ERC721Upgradeable
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721Upgradeable, AccessControlUpgradeable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    // ---------------------------------------------------------------------
    // UUPS
    // ---------------------------------------------------------------------

    /// @dev Restricts upgrades to UPGRADER_ROLE.
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(UPGRADER_ROLE) { }
}
