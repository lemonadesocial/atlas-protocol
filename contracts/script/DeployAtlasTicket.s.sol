// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import { Script, console2 } from "forge-std/Script.sol";
import { AtlasTicket } from "../src/AtlasTicket.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// @title DeployAtlasTicket
/// @notice Deploys AtlasTicket (UUPS proxy) to a deterministic CREATE2 address across EVM chains.
/// @dev Set env vars before running:
///        ADMIN    — DEFAULT_ADMIN_ROLE recipient (governance multisig)
///        MINTER   — MINTER_ROLE recipient (ATLAS-managed wallet that mints after settlement)
///        PAUSER   — PAUSER_ROLE recipient (operations multisig)
///        UPGRADER — UPGRADER_ROLE recipient (governance multisig + timelock recommended)
///        NAME     — ERC-721 collection name (e.g. "ATLAS Ticket")
///        SYMBOL   — ERC-721 collection symbol (e.g. "ATLAS")
///
///      The script grants `MINTER_ROLE`, `PAUSER_ROLE`, and `UPGRADER_ROLE` at initialization
///      time but intentionally does NOT pre-grant `BURNER_ROLE`. Operators decide which
///      account drives refund-side burns post-deploy (typically the same settlement service
///      that calls FeeRouter.reverseSettle()) and grant the role with:
///
///          cast send $PROXY "grantRole(bytes32,address)" \
///              $(cast keccak "BURNER_ROLE") \
///              $BURNER_ADDRESS \
///              --account admin
///
///      See `contracts/deploy/<chain>.md` §"AtlasTicket BURNER_ROLE" for chain-specific notes.
contract DeployAtlasTicket is Script {
    /// @dev Nick's deterministic CREATE2 factory — same address on every major EVM chain.
    address internal constant DETERMINISTIC_FACTORY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    string internal constant VERSION = "atlas-protocol/AtlasTicket v0.1.0";

    function run() external {
        address admin = vm.envAddress("ADMIN");
        address minter = vm.envAddress("MINTER");
        address pauser = vm.envAddress("PAUSER");
        address upgrader = vm.envAddress("UPGRADER");
        string memory name_ = vm.envString("NAME");
        string memory symbol_ = vm.envString("SYMBOL");

        vm.startBroadcast();

        // Implementation can stay CREATE — different per chain is OK; only the proxy address
        // matters to integrators (they store the proxy address and forget the impl).
        AtlasTicket impl = new AtlasTicket();

        bytes32 salt = keccak256(abi.encodePacked(VERSION));
        bytes memory initData =
            abi.encodeCall(AtlasTicket.initialize, (admin, minter, pauser, upgrader, name_, symbol_));
        bytes memory initCode = abi.encodePacked(type(ERC1967Proxy).creationCode, abi.encode(address(impl), initData));
        address expected = _create2Address(salt, keccak256(initCode), DETERMINISTIC_FACTORY);

        // Deploy proxy via Nick's deterministic factory — same address on every major EVM chain.
        (bool ok, bytes memory ret) = DETERMINISTIC_FACTORY.call(abi.encodePacked(salt, initCode));
        require(ok, "CREATE2 deploy failed");
        address proxy = address(uint160(bytes20(ret)));
        require(proxy == expected, "CREATE2 address mismatch");

        console2.log("AtlasTicket impl  :", address(impl));
        console2.log("AtlasTicket proxy :", proxy);
        console2.log("Expected addr     :", expected);

        vm.stopBroadcast();
    }

    function _create2Address(bytes32 salt, bytes32 initCodeHash, address deployer) internal pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), deployer, salt, initCodeHash)))));
    }
}
