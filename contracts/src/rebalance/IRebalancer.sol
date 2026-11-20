// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Hook the factory calls when an index is created (mode chosen at creation, spec §5.7).
interface IRebalancer {
    function registerIndex(address index, address creator, uint8 mode, uint32 driftBps) external;
}
