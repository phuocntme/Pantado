// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title IPriceOracle
/// @notice USD per whole token, 1e18 fixed point (spec §5.3).
interface IPriceOracle {
    /// @notice Fresh price; reverts `PriceStale` if older than the asset's maxAge.
    function getPrice(address asset) external view returns (uint256 priceWad);

    /// @notice Last price and its timestamp, without a freshness check (views, redeem-safe reads).
    function latest(address asset) external view returns (uint256 priceWad, uint256 updatedAt);

    function isFresh(address asset) external view returns (bool);
}
