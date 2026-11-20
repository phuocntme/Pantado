// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {IVenue} from "./IVenue.sol";

/// @notice Constant-product pair (Uniswap v2 and its forks).
interface IUniV2Pair {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external;
}

/// @notice Solidly-style pair (volatile or stable curve): quotes itself, swaps like a v2 pair.
interface ISolidlyPair is IUniV2Pair {
    function getAmountOut(uint256 amountIn, address tokenIn) external view returns (uint256);
}

/// @notice Liquidity Book pair (v2.1 / v2.2).
interface ILBPair {
    function getTokenX() external view returns (address);
    function getTokenY() external view returns (address);
    function getSwapOut(uint128 amountIn, bool swapForY)
        external
        view
        returns (uint128 amountInLeft, uint128 amountOut, uint128 fee);
    function swap(bool swapForY, address to) external returns (bytes32 amountsOut);
}

/// @title DexVenue
/// @notice Production token venue (spec §7): swaps a registry token against the quote token (USDC) through a
///         registry-configured path of Avalanche DEX pools. Every hop's output is computed on-chain from the pool's
///         own state (v2 reserves, Solidly getAmountOut, Liquidity Book getSwapOut), so `quote` returns exactly what
///         `swapExactIn` pays in the same block. Tokens move pool to pool: the input goes straight from the caller
///         to the first pool, each hop pays the next pool, the last pays `to`. Pools whose output cannot be computed
///         in a view (concentrated liquidity) are not routable here.
contract DexVenue is IVenue, Ownable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    enum Kind {
        UniV2,
        Solidly,
        LiquidityBook
    }

    struct Hop {
        address pool;
        Kind kind;
        /// @dev UniV2 swap fee in basis points (e.g. 30 = 0.30 %); unused for the other kinds.
        uint16 feeBps;
    }

    IERC20 public immutable usdc;
    mapping(address asset => Hop[]) internal _routes;

    event RouteSet(address indexed asset, Hop[] hops);

    error ZeroAddress();
    error NoRoute(address asset);
    error NotAgainstQuote(address tokenIn, address tokenOut);
    error BadRoute(address asset, uint256 hop);
    error BadFee(uint256 hop);
    error InsufficientLiquidity(address pool);
    error Slippage(uint256 got, uint256 min);
    error ZeroAmount();

    constructor(address owner_, address usdc_) Ownable(owner_) {
        if (usdc_ == address(0)) revert ZeroAddress();
        usdc = IERC20(usdc_);
    }

    // ================================================================ admin

    /// @notice Path from `asset` to USDC. Each pool must hold the previous hop's output; the last must end in USDC.
    ///         An empty path removes the route.
    function setRoute(address asset, Hop[] calldata hops) external onlyOwner {
        if (asset == address(0) || asset == address(usdc)) revert ZeroAddress();
        delete _routes[asset];
        address cur = asset;
        for (uint256 i; i < hops.length; ++i) {
            Hop calldata h = hops[i];
            if (h.kind == Kind.UniV2 && (h.feeBps == 0 || h.feeBps >= 10_000)) revert BadFee(i);
            (address a, address b) = _tokens(h);
            if (cur == a) cur = b;
            else if (cur == b) cur = a;
            else revert BadRoute(asset, i);
            _routes[asset].push(h);
        }
        if (hops.length != 0 && cur != address(usdc)) revert BadRoute(asset, hops.length);
        emit RouteSet(asset, hops);
    }

    function route(address asset) external view returns (Hop[] memory) {
        return _routes[asset];
    }

    // ================================================================ IVenue

    /// @inheritdoc IVenue
    function quote(address tokenIn, address tokenOut, uint256 amountIn) external view returns (uint256 amountOut) {
        (Hop[] memory hops, bool forward) = _path(tokenIn, tokenOut);
        amountOut = amountIn;
        address cur = tokenIn;
        for (uint256 k; k < hops.length; ++k) {
            Hop memory h = hops[forward ? k : hops.length - 1 - k];
            (amountOut, cur) = _hopOut(h, cur, amountOut);
        }
    }

    /// @inheritdoc IVenue
    function swapExactIn(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address to)
        external
        nonReentrant
        returns (uint256 amountOut)
    {
        if (amountIn == 0) revert ZeroAmount();
        (Hop[] memory hops, bool forward) = _path(tokenIn, tokenOut);
        uint256 n = hops.length;
        IERC20(tokenIn).safeTransferFrom(msg.sender, hops[forward ? 0 : n - 1].pool, amountIn);
        uint256 balBefore = IERC20(tokenOut).balanceOf(to);
        amountOut = amountIn;
        address cur = tokenIn;
        for (uint256 k; k < n; ++k) {
            Hop memory h = hops[forward ? k : n - 1 - k];
            address recipient = k + 1 == n ? to : hops[forward ? k + 1 : n - 2 - k].pool;
            address next;
            (amountOut, next) = _hopOut(h, cur, amountOut);
            _hopSwap(h, cur, amountOut, recipient);
            cur = next;
        }
        // what `to` actually received (a fee-on-transfer token would show here)
        uint256 received = IERC20(tokenOut).balanceOf(to) - balBefore;
        if (received < amountOut) amountOut = received;
        if (amountOut < minOut) revert Slippage(amountOut, minOut);
    }

    // ================================================================ internals

    /// @dev Route for a token ↔ USDC swap and its direction (forward = token → USDC).
    function _path(address tokenIn, address tokenOut) internal view returns (Hop[] memory hops, bool forward) {
        address asset;
        if (tokenOut == address(usdc) && tokenIn != address(usdc)) {
            (asset, forward) = (tokenIn, true);
        } else if (tokenIn == address(usdc) && tokenOut != address(usdc)) {
            (asset, forward) = (tokenOut, false);
        } else {
            revert NotAgainstQuote(tokenIn, tokenOut);
        }
        hops = _routes[asset];
        if (hops.length == 0) revert NoRoute(asset);
    }

    function _tokens(Hop memory h) internal view returns (address a, address b) {
        if (h.kind == Kind.LiquidityBook) return (ILBPair(h.pool).getTokenX(), ILBPair(h.pool).getTokenY());
        return (IUniV2Pair(h.pool).token0(), IUniV2Pair(h.pool).token1());
    }

    /// @dev Output of one hop for `amountIn` of `tokenIn` from the pool's current state, and the token it pays.
    function _hopOut(Hop memory h, address tokenIn, uint256 amountIn)
        internal
        view
        returns (uint256 out, address tokenOut)
    {
        if (h.kind == Kind.LiquidityBook) {
            ILBPair p = ILBPair(h.pool);
            address x = p.getTokenX();
            bool swapForY = tokenIn == x;
            tokenOut = swapForY ? p.getTokenY() : x;
            if (amountIn > type(uint128).max) revert InsufficientLiquidity(h.pool);
            (uint128 left, uint128 o,) = p.getSwapOut(uint128(amountIn), swapForY);
            if (left != 0) revert InsufficientLiquidity(h.pool);
            return (o, tokenOut);
        }
        IUniV2Pair pair = IUniV2Pair(h.pool);
        address t0 = pair.token0();
        tokenOut = tokenIn == t0 ? pair.token1() : t0;
        if (h.kind == Kind.Solidly) return (ISolidlyPair(h.pool).getAmountOut(amountIn, tokenIn), tokenOut);
        (uint112 r0, uint112 r1,) = pair.getReserves();
        (uint256 rIn, uint256 rOut) = tokenIn == t0 ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
        uint256 inWithFee = amountIn * (10_000 - h.feeBps);
        out = (inWithFee * rOut) / (rIn * 10_000 + inWithFee);
    }

    /// @dev Executes one hop whose input already sits in the pool; pays `out` of the other token to `to`.
    function _hopSwap(Hop memory h, address tokenIn, uint256 out, address to) internal {
        if (out == 0) revert InsufficientLiquidity(h.pool);
        if (h.kind == Kind.LiquidityBook) {
            ILBPair(h.pool).swap(tokenIn == ILBPair(h.pool).getTokenX(), to);
            return;
        }
        bool zeroForOne = tokenIn == IUniV2Pair(h.pool).token0();
        IUniV2Pair(h.pool).swap(zeroForOne ? 0 : out, zeroForOne ? out : 0, to, "");
    }
}
