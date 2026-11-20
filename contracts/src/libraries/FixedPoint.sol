// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title FixedPoint
/// @notice 1e18 fixed-point and basis-point helpers. Prices are USD per whole token, 1e18 (spec §5.3).
library FixedPoint {
    uint256 internal constant WAD = 1e18;
    uint256 internal constant BPS = 10_000;

    /// @dev floor(a * b / 1e18)
    function mulWad(uint256 a, uint256 b) internal pure returns (uint256) {
        return Math.mulDiv(a, b, WAD);
    }

    /// @dev ceil(a * b / 1e18)
    function mulWadUp(uint256 a, uint256 b) internal pure returns (uint256) {
        return Math.mulDiv(a, b, WAD, Math.Rounding.Ceil);
    }

    /// @dev floor(a * 1e18 / b)
    function divWad(uint256 a, uint256 b) internal pure returns (uint256) {
        return Math.mulDiv(a, WAD, b);
    }

    /// @dev floor(a * bps / 10000)
    function mulBps(uint256 a, uint256 bps) internal pure returns (uint256) {
        return Math.mulDiv(a, bps, BPS);
    }

    /// @dev ceil(a * bps / 10000)
    function mulBpsUp(uint256 a, uint256 bps) internal pure returns (uint256) {
        return Math.mulDiv(a, bps, BPS, Math.Rounding.Ceil);
    }

    /// @notice USD value (1e18) of `amount` base units of a token with `decimals` at `priceWad`.
    function valueOf(uint256 amount, uint256 priceWad, uint8 decimals) internal pure returns (uint256) {
        return Math.mulDiv(amount, priceWad, 10 ** decimals);
    }

    /// @notice Base units of a token with `decimals` worth `usdWad` at `priceWad` (floor).
    function amountFor(uint256 usdWad, uint256 priceWad, uint8 decimals) internal pure returns (uint256) {
        return Math.mulDiv(usdWad, 10 ** decimals, priceWad);
    }
}
