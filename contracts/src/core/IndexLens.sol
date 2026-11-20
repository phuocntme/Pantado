// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {FixedPoint} from "../libraries/FixedPoint.sol";
import {IPriceOracle} from "../oracle/IPriceOracle.sol";
import {IVenue} from "../venues/IVenue.sol";
import {AssetRegistry} from "./AssetRegistry.sol";
import {IndexVault} from "./IndexVault.sol";
import {IIndexRegistry} from "./IIndexRegistry.sol";
import {Rebalancer} from "../rebalance/Rebalancer.sol";

/// @title IndexLens
/// @notice Read views for the app, the indexer and tests (spec §5.10). The level here is the reference the
///         indexer must match at the same block. Uses the last pushed prices without a freshness check and
///         reports freshness separately.
contract IndexLens {
    struct Basket {
        address[] assets;
        uint8[] decimals;
        uint256[] balances;
        uint256[] prices;
        bool[] fresh;
        uint256[] values; // USD 1e18
        uint256[] currentBps;
        uint16[] targetBps;
        uint256[] driftBps; // relative drift |c − w| / w, in bps
        uint256 value; // V, USD 1e18
        uint256 supply; // S
        uint256 level; // L = V / S, USD 1e18 per unit
        uint256 maxDriftBps;
        bool allFresh;
    }

    /// @notice Level of an index in USD (1e18) per unit; 0 if supply is 0.
    function level(address index) public view returns (uint256) {
        (uint256 v, uint256 s) = valueAndSupply(index);
        return s == 0 ? 0 : Math.mulDiv(v, 1e18, s);
    }

    function valueAndSupply(address index) public view returns (uint256 value, uint256 supply) {
        IndexVault vault = IndexVault(index);
        IPriceOracle oracle = vault.oracle();
        address[] memory a = vault.assets();
        uint8[] memory d = vault.assetDecimals();
        uint256[] memory b = vault.balances();
        for (uint256 i; i < a.length; ++i) {
            (uint256 p,) = oracle.latest(a[i]);
            value += FixedPoint.valueOf(b[i], p, d[i]);
        }
        supply = vault.totalSupply();
    }

    function basket(address index) public view returns (Basket memory k) {
        IndexVault vault = IndexVault(index);
        IPriceOracle oracle = vault.oracle();
        k.assets = vault.assets();
        k.decimals = vault.assetDecimals();
        k.balances = vault.balances();
        k.targetBps = vault.targetWeights();
        uint256 n = k.assets.length;
        k.prices = new uint256[](n);
        k.fresh = new bool[](n);
        k.values = new uint256[](n);
        k.currentBps = new uint256[](n);
        k.driftBps = new uint256[](n);
        k.allFresh = true;
        for (uint256 i; i < n; ++i) {
            (k.prices[i],) = oracle.latest(k.assets[i]);
            k.fresh[i] = oracle.isFresh(k.assets[i]);
            if (!k.fresh[i]) k.allFresh = false;
            k.values[i] = FixedPoint.valueOf(k.balances[i], k.prices[i], k.decimals[i]);
            k.value += k.values[i];
        }
        k.supply = vault.totalSupply();
        k.level = k.supply == 0 ? 0 : Math.mulDiv(k.value, 1e18, k.supply);
        if (k.value == 0) return k;
        for (uint256 i; i < n; ++i) {
            k.currentBps[i] = Math.mulDiv(k.values[i], 10_000, k.value);
            k.driftBps[i] = relativeDriftBps(k.values[i], k.value, k.targetBps[i]);
            if (k.driftBps[i] > k.maxDriftBps) k.maxDriftBps = k.driftBps[i];
        }
    }

    /// @notice |c − w| / w in bps, with c = value/total, computed without intermediate rounding of c.
    function relativeDriftBps(uint256 value, uint256 total, uint256 targetBps) public pure returns (uint256) {
        uint256 a = value * 10_000;
        uint256 b = targetBps * total;
        uint256 diff = a > b ? a - b : b - a;
        return Math.mulDiv(diff, 10_000, b);
    }

    function maxDriftBps(address index) external view returns (uint256) {
        return basket(index).maxDriftBps;
    }

    // ================================================================ previews (same math as the vault)

    /// @notice Units a buy of `usdcIn` mints right now; reverts like the buy would (stale, paused, empty).
    function previewBuy(address index, uint256 usdcIn) external view returns (uint256 units, uint256 fee) {
        IndexVault vault = IndexVault(index);
        IPriceOracle oracle = vault.oracle();
        AssetRegistry reg = vault.assetRegistry();
        address usdc = address(vault.usdc());
        address[] memory a = vault.assets();
        uint8[] memory d = vault.assetDecimals();
        uint256[] memory bal = vault.balances();
        uint256 supply = vault.totalSupply();
        uint256 n = a.length;

        uint256[] memory val = new uint256[](n);
        uint256 value;
        for (uint256 i; i < n; ++i) {
            uint256 p = oracle.getPrice(a[i]);
            if (reg.buysPaused(a[i])) revert IndexVault.BuysPausedFor(a[i]);
            val[i] = FixedPoint.valueOf(bal[i], p, d[i]);
            value += val[i];
        }
        fee = FixedPoint.mulBps(usdcIn, vault.tradeFeeBps());
        uint256 net = usdcIn - fee;

        if (supply == 0) {
            uint16[] memory w = vault.targetWeights();
            uint256 spent;
            uint256 v;
            for (uint256 i; i < n; ++i) {
                uint256 spend = i == n - 1 ? net - spent : FixedPoint.mulBps(net, w[i]);
                spent += spend;
                uint256 q = IVenue(reg.venueOf(a[i])).quote(usdc, a[i], spend);
                v += FixedPoint.valueOf(q, oracle.getPrice(a[i]), d[i]);
            }
            uint256 total = v / vault.startLevelUsd();
            units = total > vault.deadUnits() ? total - vault.deadUnits() : 0;
            return (units, fee);
        }
        if (value == 0) revert IndexVault.EmptyBasket();

        units = type(uint256).max;
        uint256 spent2;
        uint256 last;
        for (uint256 i; i < n; ++i) {
            if (bal[i] != 0) last = i;
        }
        for (uint256 i; i < n; ++i) {
            if (bal[i] == 0) continue;
            uint256 spend = i == last ? net - spent2 : Math.mulDiv(net, val[i], value);
            spent2 += spend;
            uint256 q = spend == 0 ? 0 : IVenue(reg.venueOf(a[i])).quote(usdc, a[i], spend);
            uint256 r = Math.mulDiv(supply, q, bal[i]);
            if (r < units) units = r;
        }
    }

    /// @notice USDC a sell of `units` pays right now (after fee).
    function previewSell(address index, uint256 units) external view returns (uint256 usdcOut, uint256 fee) {
        IndexVault vault = IndexVault(index);
        IPriceOracle oracle = vault.oracle();
        AssetRegistry reg = vault.assetRegistry();
        address usdc = address(vault.usdc());
        address[] memory a = vault.assets();
        uint256[] memory bal = vault.balances();
        uint256 supply = vault.totalSupply();
        uint256 gross;
        for (uint256 i; i < a.length; ++i) {
            oracle.getPrice(a[i]);
            uint256 out = Math.mulDiv(bal[i], units, supply);
            if (out == 0) continue;
            gross += IVenue(reg.venueOf(a[i])).quote(a[i], usdc, out);
        }
        fee = FixedPoint.mulBps(gross, vault.tradeFeeBps());
        usdcOut = gross - fee;
    }

    /// @notice In-kind amounts a redeem of `units` returns (never reverts on prices).
    function previewRedeem(address index, uint256 units) external view returns (uint256[] memory amounts) {
        IndexVault vault = IndexVault(index);
        uint256[] memory bal = vault.balances();
        uint256 supply = vault.totalSupply();
        amounts = new uint256[](bal.length);
        for (uint256 i; i < bal.length; ++i) {
            amounts[i] = Math.mulDiv(bal[i], units, supply);
        }
    }

    // ================================================================ rebalance state

    struct PlanState {
        Rebalancer.Mode mode;
        uint32 driftBps;
        bool modeChangePending;
        Rebalancer.Mode pendingMode;
        uint64 pendingAt;
        uint32 version;
        Rebalancer.Plan plan;
        Rebalancer.Auction auction;
        uint256 auctionPrice; // 0 when no live auction
        bool auctionLive;
        uint256 tradedLast24h;
    }

    /// @notice Mode, version, current plan and auction of an index (spec §5.7–5.8).
    function planState(address index) external view returns (PlanState memory ps) {
        Rebalancer rb = Rebalancer(IIndexRegistry(IndexVault(index).factory()).rebalancer());
        (Rebalancer.IndexState memory s, Rebalancer.Mode m, uint32 d) = rb.state(index);
        ps.mode = m;
        ps.driftBps = d;
        ps.modeChangePending = s.hasPending && block.timestamp < s.pendingAt;
        ps.pendingMode = s.pendingMode;
        ps.pendingAt = s.pendingAt;
        ps.version = s.version;
        ps.plan = rb.plan(index);
        ps.auction = rb.auction(index);
        ps.auctionLive = ps.auction.id != 0 && ps.auction.filled < ps.auction.lot && block.timestamp < ps.auction.endAt
            && ps.plan.status == Rebalancer.Status.Active;
        if (ps.auctionLive) ps.auctionPrice = rb.currentPrice(index);
        ps.tradedLast24h = rb.tradedLast24h(index);
    }
}
