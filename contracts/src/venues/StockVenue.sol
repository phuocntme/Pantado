// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {FixedPoint} from "../libraries/FixedPoint.sol";
import {IPriceOracle} from "../oracle/IPriceOracle.sol";
import {IVenue} from "./IVenue.sol";
import {PToken} from "./PToken.sol";

/// @title StockVenue
/// @notice Synthetic, pluggable stock venue (spec §6). Trades 24/7 against a USDC reserve at oracle mid ± spread:
///         USDC → stock mints the pToken, stock → USDC burns it and pays from the reserve. Per-asset size and
///         open-interest caps, a global reserve-ratio guard on buys, and an admin pause of new buys per asset.
///         `quote` returns exactly what `swapExactIn` pays in the same block.
contract StockVenue is IVenue, Ownable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    struct Market {
        bool listed;
        bool buysPaused;
        uint16 spreadBps;
        uint256 sizeCapUsd; // per trade, USD 1e18
        uint256 oiCapUsd; // outstanding notional at mid, USD 1e18
    }

    IPriceOracle public immutable oracle;
    IERC20 public immutable usdc;
    uint8 public immutable usdcDecimals;
    uint16 public reserveRatioBps;
    uint256 public funded; // USDC deposited by the admin, net of withdrawals

    mapping(address pToken => Market) public markets;
    address[] internal _pTokens;

    event Listed(address indexed pToken, string name, string symbol);
    event Minted(address indexed pToken, address indexed to, uint256 usdcIn, uint256 amount, uint256 price);
    event Burned(address indexed pToken, address indexed to, uint256 amount, uint256 usdcOut, uint256 price);
    event CapsSet(address indexed pToken, uint256 sizeCapUsd, uint256 oiCapUsd, uint16 spreadBps);
    event BuysPaused(address indexed pToken, bool paused);
    event ReserveRatioSet(uint16 reserveRatioBps);
    event Funded(uint256 amount);
    event Withdrawn(uint256 amount, address to);

    error UnsupportedPair(address tokenIn, address tokenOut);
    error BuysPausedFor(address pToken);
    error SizeCapExceeded(uint256 usd, uint256 cap);
    error OiCapExceeded(uint256 usd, uint256 cap);
    error ReserveGuard(uint256 requiredUsd, uint256 reserveUsd);
    error InsufficientReserve(uint256 needed, uint256 available);
    error Slippage(uint256 got, uint256 min);
    error BadParams();

    constructor(address owner_, address oracle_, address usdc_, uint16 reserveRatioBps_) Ownable(owner_) {
        if (reserveRatioBps_ < 10_000) revert BadParams();
        oracle = IPriceOracle(oracle_);
        usdc = IERC20(usdc_);
        usdcDecimals = IERC20Metadata(usdc_).decimals();
        reserveRatioBps = reserveRatioBps_;
    }

    // ================================================================ admin

    /// @notice Deploy and list a pToken. Caps are whole USD.
    function listStock(string calldata name_, string calldata symbol_, uint256 sizeCapUsd, uint256 oiCapUsd, uint16 spreadBps)
        external
        onlyOwner
        returns (address pToken)
    {
        pToken = address(new PToken(name_, symbol_, address(this)));
        _pTokens.push(pToken);
        markets[pToken].listed = true;
        emit Listed(pToken, name_, symbol_);
        _setCaps(pToken, sizeCapUsd, oiCapUsd, spreadBps);
    }

    function setCaps(address pToken, uint256 sizeCapUsd, uint256 oiCapUsd, uint16 spreadBps) external onlyOwner {
        if (!markets[pToken].listed) revert UnsupportedPair(pToken, address(usdc));
        _setCaps(pToken, sizeCapUsd, oiCapUsd, spreadBps);
    }

    function _setCaps(address pToken, uint256 sizeCapUsd, uint256 oiCapUsd, uint16 spreadBps) internal {
        if (spreadBps >= 10_000 || sizeCapUsd == 0 || oiCapUsd == 0) revert BadParams();
        Market storage m = markets[pToken];
        m.sizeCapUsd = sizeCapUsd * 1e18;
        m.oiCapUsd = oiCapUsd * 1e18;
        m.spreadBps = spreadBps;
        emit CapsSet(pToken, sizeCapUsd, oiCapUsd, spreadBps);
    }

    /// @notice Pause new buys of one stock. Sells stay open while the reserve allows.
    function setBuysPaused(address pToken, bool paused) external onlyOwner {
        if (!markets[pToken].listed) revert UnsupportedPair(pToken, address(usdc));
        markets[pToken].buysPaused = paused;
        emit BuysPaused(pToken, paused);
    }

    function setReserveRatio(uint16 bps) external onlyOwner {
        if (bps < 10_000) revert BadParams();
        reserveRatioBps = bps;
        emit ReserveRatioSet(bps);
    }

    /// @notice Seed the reserve (contest: deployer only).
    function fund(uint256 amount) external onlyOwner {
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        funded += amount;
        emit Funded(amount);
    }

    /// @notice Withdraw reserve above what the ratio guard requires.
    function withdraw(uint256 amount, address to) external onlyOwner {
        uint256 res = reserve();
        uint256 required = _usdcFor(Math.mulDiv(totalExposureUsd(), reserveRatioBps, 10_000));
        if (res < amount || res - amount < required) revert InsufficientReserve(required + amount, res);
        funded = funded > amount ? funded - amount : 0;
        usdc.safeTransfer(to, amount);
        emit Withdrawn(amount, to);
    }

    // ================================================================ IVenue

    function quote(address tokenIn, address tokenOut, uint256 amountIn) public view returns (uint256 amountOut) {
        if (tokenIn == address(usdc)) return _quoteBuy(tokenOut, amountIn);
        if (tokenOut == address(usdc)) return _quoteSell(tokenIn, amountIn);
        revert UnsupportedPair(tokenIn, tokenOut);
    }

    function swapExactIn(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address to)
        external
        nonReentrant
        returns (uint256 amountOut)
    {
        amountOut = quote(tokenIn, tokenOut, amountIn);
        if (amountOut < minOut) revert Slippage(amountOut, minOut);
        if (tokenIn == address(usdc)) {
            usdc.safeTransferFrom(msg.sender, address(this), amountIn);
            PToken(tokenOut).mint(to, amountOut);
            emit Minted(tokenOut, to, amountIn, amountOut, oracle.getPrice(tokenOut));
        } else {
            PToken(tokenIn).burn(msg.sender, amountIn);
            usdc.safeTransfer(to, amountOut);
            emit Burned(tokenIn, to, amountIn, amountOut, oracle.getPrice(tokenIn));
        }
    }

    function _quoteBuy(address pToken, uint256 usdcIn) internal view returns (uint256 out) {
        Market memory m = markets[pToken];
        if (!m.listed) revert UnsupportedPair(address(usdc), pToken);
        if (m.buysPaused) revert BuysPausedFor(pToken);
        uint256 mid = oracle.getPrice(pToken); // stale → revert
        uint256 usd = FixedPoint.valueOf(usdcIn, 1e18, usdcDecimals);
        if (usd > m.sizeCapUsd) revert SizeCapExceeded(usd, m.sizeCapUsd);
        uint256 exec = FixedPoint.mulBpsUp(mid, 10_000 + m.spreadBps);
        out = Math.mulDiv(usd, 1e18, exec); // pTokens have 18 decimals

        uint256 newOi = FixedPoint.mulWad(IERC20(pToken).totalSupply() + out, mid);
        if (newOi > m.oiCapUsd) revert OiCapExceeded(newOi, m.oiCapUsd);
        // reserve guard on the whole book after this buy
        uint256 exposure = totalExposureUsd() + FixedPoint.mulWad(out, mid);
        uint256 reserveUsd = FixedPoint.valueOf(reserve() + usdcIn, 1e18, usdcDecimals);
        uint256 required = Math.mulDiv(exposure, reserveRatioBps, 10_000);
        if (required > reserveUsd) revert ReserveGuard(required, reserveUsd);
    }

    function _quoteSell(address pToken, uint256 amountIn) internal view returns (uint256 out) {
        Market memory m = markets[pToken];
        if (!m.listed) revert UnsupportedPair(pToken, address(usdc));
        uint256 mid = oracle.getPrice(pToken);
        uint256 exec = FixedPoint.mulBps(mid, 10_000 - m.spreadBps);
        out = _usdcFor(FixedPoint.mulWad(amountIn, exec));
        uint256 res = reserve();
        if (out > res) revert InsufficientReserve(out, res);
    }

    function _usdcFor(uint256 usdWad) internal view returns (uint256) {
        return FixedPoint.amountFor(usdWad, 1e18, usdcDecimals);
    }

    // ================================================================ views

    function reserve() public view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    function outstanding(address pToken) public view returns (uint256) {
        return IERC20(pToken).totalSupply();
    }

    /// @notice Outstanding notional at the last oracle mid (USD 1e18). Never reverts on stale prices.
    function exposureUsd(address pToken) public view returns (uint256) {
        (uint256 mid,) = oracle.latest(pToken);
        return FixedPoint.mulWad(outstanding(pToken), mid);
    }

    function totalExposureUsd() public view returns (uint256 sum) {
        for (uint256 i; i < _pTokens.length; ++i) {
            sum += exposureUsd(_pTokens[i]);
        }
    }

    /// @notice Venue PnL (USD 1e18): reserve − funded − exposure at mid.
    function pnlUsd() external view returns (int256) {
        uint256 res = FixedPoint.valueOf(reserve(), 1e18, usdcDecimals);
        uint256 fundedUsd = FixedPoint.valueOf(funded, 1e18, usdcDecimals);
        return int256(res) - int256(fundedUsd) - int256(totalExposureUsd());
    }

    /// @notice reserve × 10 000 / exposure, in bps (type(uint256).max when nothing is outstanding).
    function reserveRatioNowBps() external view returns (uint256) {
        uint256 e = totalExposureUsd();
        if (e == 0) return type(uint256).max;
        return Math.mulDiv(FixedPoint.valueOf(reserve(), 1e18, usdcDecimals), 10_000, e);
    }

    function pTokens() external view returns (address[] memory) {
        return _pTokens;
    }
}
