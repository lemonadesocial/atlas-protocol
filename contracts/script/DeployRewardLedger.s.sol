// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import { Script, console2 } from "forge-std/Script.sol";
import { RewardLedger } from "../src/RewardLedger.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// @title DeployRewardLedger
/// @notice Deploys RewardLedger (UUPS proxy) to a deterministic CREATE2 address across EVM chains.
/// @dev Set env vars before running:
///        ADMIN      — DEFAULT_ADMIN_ROLE recipient (governance multisig)
///        RECORDER   — RECORDER_ROLE recipient (FeeRouter or operations server)
///        PAUSER     — PAUSER_ROLE recipient (operations multisig)
///        UPGRADER   — UPGRADER_ROLE recipient (governance multisig + timelock recommended)
///        STABLECOIN — ERC-20 stablecoin address on the target chain (USDC, USDm, etc.)
contract DeployRewardLedger is Script {
    /// @dev Nick's deterministic CREATE2 factory — same address on every major EVM chain.
    address internal constant DETERMINISTIC_FACTORY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    string internal constant VERSION = "atlas-protocol/RewardLedger v0.1.0";

    function run() external {
        address admin = vm.envAddress("ADMIN");
        address recorder = vm.envAddress("RECORDER");
        address pauser = vm.envAddress("PAUSER");
        address upgrader = vm.envAddress("UPGRADER");
        address stablecoin = vm.envAddress("STABLECOIN");

        vm.startBroadcast();

        // Implementation can stay CREATE — different per chain is OK; only the proxy address
        // matters to integrators (they store the proxy address and forget the impl).
        RewardLedger impl = new RewardLedger();

        bytes32 salt = keccak256(abi.encodePacked(VERSION));
        bytes memory initData =
            abi.encodeCall(RewardLedger.initialize, (admin, recorder, pauser, upgrader, stablecoin));
        bytes memory initCode = abi.encodePacked(type(ERC1967Proxy).creationCode, abi.encode(address(impl), initData));
        address expected = _create2Address(salt, keccak256(initCode), DETERMINISTIC_FACTORY);

        // Deploy proxy via Nick's deterministic factory — same address on every major EVM chain.
        (bool ok, bytes memory ret) = DETERMINISTIC_FACTORY.call(abi.encodePacked(salt, initCode));
        require(ok, "CREATE2 deploy failed");
        address proxy = address(uint160(bytes20(ret)));
        require(proxy == expected, "CREATE2 address mismatch");

        console2.log("RewardLedger impl  :", address(impl));
        console2.log("RewardLedger proxy :", proxy);
        console2.log("Expected addr      :", expected);

        vm.stopBroadcast();
    }

    function _create2Address(bytes32 salt, bytes32 initCodeHash, address deployer) internal pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), deployer, salt, initCodeHash)))));
    }
}
