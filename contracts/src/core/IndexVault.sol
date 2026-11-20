// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {FixedPoint} from "../libraries/FixedPoint.sol";
import {IPriceOracle} from "../oracle/IPriceOracle.sol";
import {IVenue} from "../venues/IVenue.sol";
import {AssetRegistry} from "./AssetRegistry.sol";
import {IIndexRegistry} from "./IIndexRegistry.sol";

interface IFeeSink {
    function accrue(uint256 fee) external;
}

/// @title IndexVault
/// @notice One index: ERC-20 units (18 dp) backed by a basket of 2–20 assets held here (spec §5).
///         Buy mints pro rata to the current basket (min ratio), sell burns pro rata, redeem in-kind is
///         always open, fee-free and price-free. Deployed as an EIP-1167 clone by IndexFactory; shared
///         dependencies are immutables of the implementation.
contract IndexVault is ERC20, Initializable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    // ------------------------------------------------ shared (implementation immutables)
    address public immutable factory;
    AssetRegistry public immutable assetRegistry;
    IPriceOracle public immutable oracle;
    IFeeSink public immutable feeSplitter;
    IERC20 public immutable usdc;
    uint16 public immutable tradeFeeBps;
    uint256 public immutable deadUnits;
    uint256 public immutable startLevelUsd;

    // ------------------------------------------------ per index
    string private _idxName;
    string private _idxSymbol;
    address public creator;
    address[] private _assets;
    uint8[] private _decimals;
    uint16[] private _weights;

    event Bought(address indexed buyer, address indexed to, uint256 usdcIn, uint256 fee, uint256 units);
    event Sold(address indexed seller, address indexed to, uint256 units, uint256 gross, uint256 fee, uint256 usdcOut);
    event Redeemed(address indexed holder, address indexed to, uint256 units, uint256[] amounts, address[] forfeited);
    event TargetWeightsSet(uint16[] weights);
    event RebalanceTransfer(address indexed asset, uint256 amount, address indexed to);

    error OnlyFactory();
    error OnlyRebalancer();
    error NotInitialized();
    error AlreadyStarted();
    error ZeroAmount();
    error EmptyBasket();
    error Slippage(uint256 got, uint256 min);
    error BuysPausedFor(address asset);
    error FirstBuyTooSmall(uint256 units, uint256 deadUnits);
    error BadWeights();
    error NotBasketAsset(address asset);

    constructor(
        address factory_,
        address assetRegistry_,
        address oracle_,
        address feeSplitter_,
        uint16 tradeFeeBps_,
        uint256 deadUnits_,
        uint256 startLevelUsd_
    ) ERC20("", "") {
        factory = factory_;
        assetRegistry = AssetRegistry(assetRegistry_);
        oracle = IPriceOracle(oracle_);
        feeSplitter = IFeeSink(feeSplitter_);
        usdc = IERC20(AssetRegistry(assetRegistry_).quote());
        tradeFeeBps = tradeFeeBps_;
        deadUnits = deadUnits_;
        startLevelUsd = startLevelUsd_;
        _disableInitializers();
    }

    modifier onlyFactory() {
        if (msg.sender != factory) revert OnlyFactory();
        _;
    }

    modifier onlyRebalancer() {
        if (msg.sender != IIndexRegistry(factory).rebalancer()) revert OnlyRebalancer();
        _;
    }

    /// @dev Factory validates assets and weights before calling.
    function initialize(
        string calldata name_,
        string calldata symbol_,
        address creator_,
        address[] calldata assets_,
        uint16[] calldata weights_
    ) external initializer onlyFactory {
        _idxName = name_;
        _idxSymbol = symbol_;
        creator = creator_;
        for (uint256 i; i < assets_.length; ++i) {
            _assets.push(assets_[i]);
            _decimals.push(assetRegistry.info(assets_[i]).decimals);
            _weights.push(weights_[i]);
        }
    }

    // ================================================================ ERC-20 metadata

    function name() public view override returns (string memory) {
        return _idxName;
    }

    function symbol() public view override returns (string memory) {
        return _idxSymbol;
    }

    // ================================================================ views

    function assets() external view returns (address[] memory) {
        return _assets;
    }

    function assetDecimals() external view returns (uint8[] memory) {
        return _decimals;
    }

    function targetWeights() external view returns (uint16[] memory) {
        return _weights;
    }

    function assetCount() external view returns (uint256) {
        return _assets.length;
    }

    function balances() public view returns (uint256[] memory b) {
        uint256 n = _assets.length;
        b = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            b[i] = IERC20(_assets[i]).balanceOf(address(this));
        }
    }

    // ================================================================ buy

    /// @notice First buy, called by the factory in the create transaction (S = 0, spec §5.4).
    ///         Spends by target weight; units = value / startLevel so the level starts at 100;
    ///         `deadUnits` of that go to 0x…dEaD so the index is never empty.
    function firstBuy(uint256 usdcIn, uint256 minUnits, address to)
        external
        onlyFactory
        nonReentrant
        returns (uint256 units)
    {
        if (totalSupply() != 0) revert AlreadyStarted();
        if (usdcIn == 0) revert ZeroAmount();
        usdc.safeTransferFrom(msg.sender, address(this), usdcIn);
        (uint256 net, uint256 fee) = _takeFee(usdcIn);

        uint256 n = _assets.length;
        uint256 spent;
        uint256 value;
        for (uint256 i; i < n; ++i) {
            address a = _assets[i];
            uint256 price = oracle.getPrice(a);
            if (assetRegistry.buysPaused(a)) revert BuysPausedFor(a);
            uint256 spend = i == n - 1 ? net - spent : FixedPoint.mulBps(net, _weights[i]);
            spent += spend;
            uint256 q = _buyLeg(a, spend);
            value += FixedPoint.valueOf(q, price, _decimals[i]);
        }
        uint256 total = value / startLevelUsd;
        if (total <= deadUnits) revert FirstBuyTooSmall(total, deadUnits);
        units = total - deadUnits;
        if (units < minUnits) revert Slippage(units, minUnits);
        _mint(DEAD, deadUnits);
        _mint(to, units);
        emit Bought(msg.sender, to, usdcIn, fee, units);
    }

    /// @notice Buy with `usdcIn` USDC. Spends pro rata to the current basket by value; mints
    ///         units = S · min_i(q_i / B_i). Excess over the min ratio stays in the vault.
    function buy(uint256 usdcIn, uint256 minUnits, address to) external nonReentrant returns (uint256 units) {
        uint256 supply = totalSupply();
        if (supply == 0) revert NotInitialized();
        if (usdcIn == 0) revert ZeroAmount();

        uint256 n = _assets.length;
        uint256[] memory bal = balances();
        uint256[] memory val = new uint256[](n);
        uint256 value;
        for (uint256 i; i < n; ++i) {
            address a = _assets[i];
            uint256 price = oracle.getPrice(a); // stale → revert
            if (assetRegistry.buysPaused(a)) revert BuysPausedFor(a);
            val[i] = FixedPoint.valueOf(bal[i], price, _decimals[i]);
            value += val[i];
        }
        if (value == 0) revert EmptyBasket();

        usdc.safeTransferFrom(msg.sender, address(this), usdcIn);
        (uint256 net, uint256 fee) = _takeFee(usdcIn);

        units = type(uint256).max;
        uint256 spent;
        uint256 last = _lastHeld(bal);
        for (uint256 i; i < n; ++i) {
            if (bal[i] == 0) continue;
            uint256 spend = i == last ? net - spent : Math.mulDiv(net, val[i], value);
            spent += spend;
            uint256 q = spend == 0 ? 0 : _buyLeg(_assets[i], spend);
            uint256 r = Math.mulDiv(supply, q, bal[i]);
            if (r < units) units = r;
        }
        if (units == 0 || units < minUnits) revert Slippage(units == type(uint256).max ? 0 : units, minUnits);
        _mint(to, units);
        emit Bought(msg.sender, to, usdcIn, fee, units);
    }

    // ================================================================ sell

    /// @notice Burn `units`, sell `B_i · s / S` of every asset to USDC, pay gross minus fee.
    function sell(uint256 units, uint256 minOut, address to) external nonReentrant returns (uint256 usdcOut) {
        if (units == 0) revert ZeroAmount();
        uint256 supply = totalSupply();
        uint256[] memory bal = balances();
        _burn(msg.sender, units);

        uint256 before = usdc.balanceOf(address(this));
        uint256 n = _assets.length;
        for (uint256 i; i < n; ++i) {
            address a = _assets[i];
            oracle.getPrice(a); // stale → revert, even if the venue would not check
            uint256 out = Math.mulDiv(bal[i], units, supply);
            if (out == 0) continue;
            address venue = assetRegistry.venueOf(a);
            IERC20(a).forceApprove(venue, out);
            IVenue(venue).swapExactIn(a, address(usdc), out, 0, address(this));
        }
        uint256 gross = usdc.balanceOf(address(this)) - before;
        (uint256 net, uint256 fee) = _takeFee(gross);
        usdcOut = net;
        if (usdcOut < minOut) revert Slippage(usdcOut, minOut);
        usdc.safeTransfer(to, usdcOut);
        emit Sold(msg.sender, to, units, gross, fee, usdcOut);
    }

    // ================================================================ redeem

    /// @notice Redeem in-kind: transfer `B_i · s / S` of every asset to `to`. No fee, no price, never paused.
    ///         Assets listed in `forfeit` are skipped and stay in the vault for the remaining holders.
    function redeem(uint256 units, address to, address[] calldata forfeit)
        external
        nonReentrant
        returns (uint256[] memory amounts)
    {
        if (units == 0) revert ZeroAmount();
        uint256 supply = totalSupply();
        uint256[] memory bal = balances();
        _burn(msg.sender, units);

        uint256 n = _assets.length;
        amounts = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            address a = _assets[i];
            if (_contains(forfeit, a)) continue;
            uint256 out = Math.mulDiv(bal[i], units, supply);
            if (out == 0) continue;
            amounts[i] = out;
            IERC20(a).safeTransfer(to, out);
        }
        emit Redeemed(msg.sender, to, units, amounts, forfeit);
    }

    // ================================================================ rebalancer hooks (spec §5.7–5.8)

    /// @notice Rebalancer moves basket assets during a fill. Guards live in the Rebalancer.
    function rebalanceTransfer(address asset, uint256 amount, address to) external onlyRebalancer nonReentrant {
        if (!_isAsset(asset)) revert NotBasketAsset(asset);
        IERC20(asset).safeTransfer(to, amount);
        emit RebalanceTransfer(asset, amount, to);
    }

    /// @notice New target weights (Manual version). Same assets, each ≥ 1 %, sum 10 000.
    function setTargetWeights(uint16[] calldata weights_) external onlyRebalancer {
        if (weights_.length != _assets.length) revert BadWeights();
        uint256 sum;
        for (uint256 i; i < weights_.length; ++i) {
            if (weights_[i] < 100) revert BadWeights();
            sum += weights_[i];
        }
        if (sum != 10_000) revert BadWeights();
        _weights = weights_;
        emit TargetWeightsSet(weights_);
    }

    // ================================================================ internals

    function _takeFee(uint256 amount) internal returns (uint256 net, uint256 fee) {
        fee = FixedPoint.mulBps(amount, tradeFeeBps);
        net = amount - fee;
        if (fee > 0) {
            usdc.safeTransfer(address(feeSplitter), fee);
            feeSplitter.accrue(fee);
        }
    }

    /// @dev Buys `asset` with `spend` USDC through its venue; returns the amount actually received.
    function _buyLeg(address asset, uint256 spend) internal returns (uint256 q) {
        address venue = assetRegistry.venueOf(asset);
        uint256 before = IERC20(asset).balanceOf(address(this));
        usdc.forceApprove(venue, spend);
        IVenue(venue).swapExactIn(address(usdc), asset, spend, 0, address(this));
        q = IERC20(asset).balanceOf(address(this)) - before;
    }

    function _lastHeld(uint256[] memory bal) internal pure returns (uint256 last) {
        for (uint256 i; i < bal.length; ++i) {
            if (bal[i] != 0) last = i;
        }
    }

    function _isAsset(address a) internal view returns (bool) {
        for (uint256 i; i < _assets.length; ++i) {
            if (_assets[i] == a) return true;
        }
        return false;
    }

    function _contains(address[] calldata list, address a) internal pure returns (bool) {
        for (uint256 i; i < list.length; ++i) {
            if (list[i] == a) return true;
        }
        return false;
    }
}
