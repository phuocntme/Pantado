// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {AssetRegistry} from "./AssetRegistry.sol";
import {IIndexRegistry} from "./IIndexRegistry.sol";
import {IndexVault} from "./IndexVault.sol";
import {IRebalancer} from "../rebalance/IRebalancer.sol";

/// @title IndexFactory
/// @notice Creates an index and makes its first buy in one transaction (spec §5.9). Keeps the index registry:
///         unique tickers, creator, visibility (public | private, private → public only).
contract IndexFactory is IIndexRegistry, Ownable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    struct Limits {
        uint256 creationFee; // quote base units
        uint256 minFirstBuy; // quote base units
        uint8 minAssets;
        uint8 maxAssets;
        uint16 minWeightBps;
    }

    struct CreateParams {
        string name;
        string ticker;
        string description;
        address[] assets;
        uint16[] weightsBps;
        uint8 mode; // 0 Off, 1 Manual, 2 Auto (validated by the Rebalancer)
        uint32 driftBps; // Auto only
        bool isPublic;
        uint256 usdcIn; // first buy, excluding the creation fee
        uint256 minUnits;
    }

    struct Info {
        address creator;
        bool isPublic;
        bool registered;
        uint64 createdAt;
    }

    uint256 public constant MAX_NAME_BYTES = 64;
    uint256 public constant MAX_DESCRIPTION_BYTES = 1024;

    AssetRegistry public immutable assetRegistry;
    IERC20 public immutable usdc;
    address public vaultImplementation;
    address public rebalancer;
    address public treasury;
    Limits public limits;

    mapping(address index => Info) internal _info;
    mapping(bytes32 tickerHash => address index) public indexByTicker;
    address[] internal _indexes;

    event IndexCreated(
        address indexed index,
        address indexed creator,
        string ticker,
        string name,
        string description,
        address[] assets,
        uint16[] weightsBps,
        uint8 mode,
        uint32 driftBps,
        bool isPublic,
        uint256 creationFee
    );
    event VisibilityChanged(address indexed index, bool isPublic);
    event VaultImplementationSet(address implementation);
    event RebalancerSet(address rebalancer);
    event TreasurySet(address treasury);
    event LimitsSet(Limits limits);

    error BadTicker();
    error TickerTaken(string ticker);
    error BadName();
    error BadAssetCount(uint256 count);
    error BadWeights();
    error UnlistedAsset(address asset);
    error DuplicateAsset(address asset);
    error FirstBuyTooSmall(uint256 usdcIn, uint256 minFirstBuy);
    error NotCreator();
    error NotIndex(address index);
    error AlreadyPublic();
    error AlreadySet();
    error ZeroAddress();

    constructor(address owner_, address assetRegistry_, address treasury_, Limits memory limits_) Ownable(owner_) {
        if (assetRegistry_ == address(0) || treasury_ == address(0)) revert ZeroAddress();
        assetRegistry = AssetRegistry(assetRegistry_);
        usdc = IERC20(AssetRegistry(assetRegistry_).quote());
        treasury = treasury_;
        _setLimits(limits_);
    }

    // ================================================================ admin

    function setVaultImplementation(address impl) external onlyOwner {
        if (vaultImplementation != address(0)) revert AlreadySet();
        if (impl == address(0)) revert ZeroAddress();
        vaultImplementation = impl;
        emit VaultImplementationSet(impl);
    }

    function setRebalancer(address rebalancer_) external onlyOwner {
        if (rebalancer != address(0)) revert AlreadySet();
        if (rebalancer_ == address(0)) revert ZeroAddress();
        rebalancer = rebalancer_;
        emit RebalancerSet(rebalancer_);
    }

    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasurySet(treasury_);
    }

    function setLimits(Limits calldata limits_) external onlyOwner {
        _setLimits(limits_);
    }

    function _setLimits(Limits memory l) internal {
        if (l.minAssets < 2 || l.minAssets > l.maxAssets || uint256(l.minWeightBps) * l.maxAssets > 10_000) {
            revert BadAssetCount(l.maxAssets);
        }
        limits = l;
        emit LimitsSet(l);
    }

    // ================================================================ create

    /// @notice Create an index and buy `p.usdcIn` of it for the caller, in one transaction. Pulls
    ///         `creationFee + usdcIn` USDC. Nothing is created if any purchase fails or a price is stale.
    function createAndBuy(CreateParams calldata p) external nonReentrant returns (address index, uint256 units) {
        Limits memory l = limits;
        bytes32 th = _validate(p, l);

        index = Clones.clone(vaultImplementation);
        _info[index] = Info({creator: msg.sender, isPublic: p.isPublic, registered: true, createdAt: uint64(block.timestamp)});
        indexByTicker[th] = index;
        _indexes.push(index);

        IndexVault(index).initialize(p.name, p.ticker, msg.sender, p.assets, p.weightsBps);
        if (rebalancer != address(0)) {
            IRebalancer(rebalancer).registerIndex(index, msg.sender, p.mode, p.driftBps);
        }

        // Emitted before the first buy so indexers see the index before its first transfers (atomic anyway).
        emit IndexCreated(
            index,
            msg.sender,
            p.ticker,
            p.name,
            p.description,
            p.assets,
            p.weightsBps,
            p.mode,
            p.driftBps,
            p.isPublic,
            l.creationFee
        );

        if (l.creationFee > 0) usdc.safeTransferFrom(msg.sender, treasury, l.creationFee);
        usdc.safeTransferFrom(msg.sender, address(this), p.usdcIn);
        usdc.forceApprove(index, p.usdcIn);
        units = IndexVault(index).firstBuy(p.usdcIn, p.minUnits, msg.sender);

    }

    function _validate(CreateParams calldata p, Limits memory l) internal view returns (bytes32 th) {
        if (!isValidTicker(p.ticker)) revert BadTicker();
        th = keccak256(bytes(p.ticker));
        if (indexByTicker[th] != address(0)) revert TickerTaken(p.ticker);
        uint256 nameLen = bytes(p.name).length;
        if (nameLen == 0 || nameLen > MAX_NAME_BYTES || bytes(p.description).length > MAX_DESCRIPTION_BYTES) {
            revert BadName();
        }
        uint256 n = p.assets.length;
        if (n < l.minAssets || n > l.maxAssets) revert BadAssetCount(n);
        if (p.weightsBps.length != n) revert BadWeights();
        uint256 sum;
        for (uint256 i; i < n; ++i) {
            address a = p.assets[i];
            if (!assetRegistry.isListed(a)) revert UnlistedAsset(a);
            for (uint256 j; j < i; ++j) {
                if (p.assets[j] == a) revert DuplicateAsset(a);
            }
            if (p.weightsBps[i] < l.minWeightBps) revert BadWeights();
            sum += p.weightsBps[i];
        }
        if (sum != 10_000) revert BadWeights();
        if (p.usdcIn < l.minFirstBuy) revert FirstBuyTooSmall(p.usdcIn, l.minFirstBuy);
    }

    /// @notice 2–6 chars, A–Z / 0–9 (spec §5.9).
    function isValidTicker(string calldata t) public pure returns (bool) {
        bytes calldata b = bytes(t);
        if (b.length < 2 || b.length > 6) return false;
        for (uint256 i; i < b.length; ++i) {
            bytes1 c = b[i];
            if (!((c >= "A" && c <= "Z") || (c >= "0" && c <= "9"))) return false;
        }
        return true;
    }

    // ================================================================ visibility

    /// @notice Private → public (no fee). Public → private is not allowed.
    function makePublic(address index) external {
        Info storage i = _info[index];
        if (!i.registered) revert NotIndex(index);
        if (i.creator != msg.sender) revert NotCreator();
        if (i.isPublic) revert AlreadyPublic();
        i.isPublic = true;
        emit VisibilityChanged(index, true);
    }

    // ================================================================ views

    function indexInfo(address index) external view returns (address creator, bool isPublic, bool registered) {
        Info storage i = _info[index];
        return (i.creator, i.isPublic, i.registered);
    }

    function info(address index) external view returns (Info memory) {
        return _info[index];
    }

    function indexCount() external view returns (uint256) {
        return _indexes.length;
    }

    function indexes(uint256 offset, uint256 limit) external view returns (address[] memory out) {
        uint256 n = _indexes.length;
        if (offset >= n) return new address[](0);
        uint256 end = offset + limit > n ? n : offset + limit;
        out = new address[](end - offset);
        for (uint256 i = offset; i < end; ++i) {
            out[i - offset] = _indexes[i];
        }
    }

    function isTickerTaken(string calldata ticker) external view returns (bool) {
        return indexByTicker[keccak256(bytes(ticker))] != address(0);
    }
}
