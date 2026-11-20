// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Index registry view implemented by IndexFactory.
interface IIndexRegistry {
    function indexInfo(address index) external view returns (address creator, bool isPublic, bool registered);
    function rebalancer() external view returns (address);
}
