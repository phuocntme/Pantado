// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title IVenue
/// @notice A venue swaps one registry asset against the quote token (spec §6, §7).
///         `quote` returns exactly what `swapExactIn` pays in the same block.
interface IVenue {
    /// @notice Output of swapping `amountIn` of `tokenIn` for `tokenOut`. Reverts like the swap would.
    function quote(address tokenIn, address tokenOut, uint256 amountIn) external view returns (uint256 amountOut);

    /// @notice Pulls `amountIn` of `tokenIn` from the caller and sends `amountOut >= minOut` of `tokenOut` to `to`.
    function swapExactIn(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address to)
        external
        returns (uint256 amountOut);
}
