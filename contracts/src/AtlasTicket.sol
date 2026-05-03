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
/// @notice Stage 2 ATLAS NFT ticket (v2 — burn flow + custodial-wallet pattern). Each token
///         represents one purchased ticket and is keyed by an off-chain `paymentId` so mints
///         are idempotent: a second mint attempt for the same paymentId reverts with the
///         existing tokenId. Pausable transfers and mints, UUPS-upgradeable, role-gated.
///         The (name, symbol) pair is supplied at initialization time so the contract is
///         portable across operators and chains.
///
///         **Custodial-wallet pattern.** When a buyer purchases with email only (no wallet),
///         the operator mints to an ATLAS-managed custodial holder address and records a
///         `keccak256(lowercase email)` hash on the token via `emailHashOf`. The ticket can
///         later be transferred to the buyer's self-custody wallet using the standard ERC-721
///         transfer flow once they connect a wallet — no special claim function is required.
///         The on-chain hash lets off-chain metadata services and indexers join the ticket to
///         the email without leaking the address itself.
///
///         **Burn flow.** A new BURNER_ROLE may invoke `burn(tokenId, paymentId)` to retire a
///         ticket as part of FeeRouter.reverseSettle() refunds. The role is granted post-deploy
///         via `grantRole(BURNER_ROLE, ...)`; the deploy script does not pre-grant it.
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

    /// @notice Role permitted to burn tickets via {burn}. Granted to the ATLAS-managed
    ///         settlement service that drives FeeRouter.reverseSettle() refunds.
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");

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

    /// @dev tokenId → keccak256 of the buyer's lowercase email, or bytes32(0) when the buyer
    ///      provided a self-custody wallet. Off-chain metadata services join on this value.
    mapping(uint256 => bytes32) private _emailHashes;

    /// @dev Reserves storage to total of 50 slots for upgrade-safety. See OZ upgradeable docs.
    ///      Slot accounting: _nextTokenId(1) + _tokenURIs(1) + _eventIds(1) + _paymentIds(1)
    ///                     + _tokenIdByPayment(1) + _emailHashes(1) + __gap(44) = 50.
    uint256[44] private __gap;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initialize the AtlasTicket NFT.
    /// @param admin Receives DEFAULT_ADMIN_ROLE.
    /// @param minter Receives MINTER_ROLE — the ATLAS-managed wallet that mints after settlement.
    /// @param pauser Receives PAUSER_ROLE.
    /// @param upgrader Receives UPGRADER_ROLE.
    /// @param name_ ERC-721 collection name (e.g. "ATLAS Ticket").
    /// @param symbol_ ERC-721 collection symbol (e.g. "ATLAS").
    /// @dev BURNER_ROLE is intentionally NOT granted here — it is granted post-deploy by the
    ///      admin via `grantRole(BURNER_ROLE, settlementService)` once the operator has
    ///      identified the wallet that will drive refund-side burns.
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
    ///
    ///      For the custodial-wallet flow, callers pass the ATLAS-managed custodial holder
    ///      address as `to` and a non-zero `emailHash`. For wallet-first buyers, callers pass
    ///      the buyer's wallet as `to` and `bytes32(0)` for `emailHash`.
    /// @param to Recipient of the freshly minted ticket. May be the ATLAS custodial holder.
    /// @param eventId Off-chain event identifier this ticket belongs to.
    /// @param paymentId Unique payment identifier; second mint with the same value reverts.
    /// @param tokenURI_ Token URI (typically an IPFS CID).
    /// @param emailHash keccak256 of the buyer's lowercase email when the buyer purchased with
    ///                  email only; `bytes32(0)` when the buyer supplied a self-custody wallet.
    /// @return tokenId The newly assigned ERC-721 token id.
    function mint(
        address to,
        uint256 eventId,
        bytes32 paymentId,
        string calldata tokenURI_,
        bytes32 emailHash
    ) external onlyRole(MINTER_ROLE) nonReentrant whenNotPaused returns (uint256 tokenId) {
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
        if (emailHash != bytes32(0)) {
            _emailHashes[tokenId] = emailHash;
        }

        // Interactions: _safeMint will call onERC721Received on contract recipients.
        _safeMint(to, tokenId);

        emit TicketMinted(tokenId, to, eventId, paymentId, tokenURI_, emailHash);
    }

    /// @notice Burn a ticket. Only callable by an account holding BURNER_ROLE.
    /// @dev Reverts TokenNotMinted if `tokenId` does not exist. Pause-gated via the inherited
    ///      ERC721Pausable `_update` hook so a paused contract cannot burn either.
    /// @param tokenId The ERC-721 token id to burn.
    /// @param paymentId The paymentId associated with the ticket; emitted in TicketBurned for
    ///                  off-chain correlation with the FeeRouter refund. The argument is not
    ///                  cross-checked against `_paymentIds[tokenId]` — callers are expected to
    ///                  pass the canonical value.
    function burn(uint256 tokenId, bytes32 paymentId)
        external
        override
        onlyRole(BURNER_ROLE)
        nonReentrant
        whenNotPaused
    {
        if (_ownerOf(tokenId) == address(0)) revert TokenNotMinted(tokenId);
        _burn(tokenId);
        emit TicketBurned(tokenId, paymentId);
    }

    /// @notice Pause mints, transfers, and burns.
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /// @notice Unpause mints, transfers, and burns.
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @notice ERC-721 metadata URI for `tokenId`.
    /// @dev Reverts TokenNotMinted instead of OpenZeppelin's default ERC721NonexistentToken so
    ///      ATLAS integrators can decode a single, contract-defined error selector. The
    ///      off-chain metadata service that hosts the URI is expected to splice the
    ///      `emailHashOf(tokenId)` value into the JSON response when present, so wallets and
    ///      indexers can surface the custodial-wallet pairing without an extra RPC call.
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

    /// @inheritdoc IAtlasTicket
    function emailHashOf(uint256 tokenId) external view override returns (bytes32) {
        if (_ownerOf(tokenId) == address(0)) revert TokenNotMinted(tokenId);
        return _emailHashes[tokenId];
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
