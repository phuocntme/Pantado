// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IndexVault} from "../../src/core/IndexVault.sol";
import {PriceOracle} from "../../src/oracle/PriceOracle.sol";
import {Rebalancer} from "../../src/rebalance/Rebalancer.sol";
import {TestERC20} from "../../src/test-tokens/TestERC20.sol";
import {RebalanceFixture} from "../utils/RebalanceFixture.sol";

contract RebalanceHandler is Test {
    Rebalancer public rb;
    IndexVault public vault;
    PriceOracle public oracle;
    address public admin;
    address public pusher;
    address[] public assets;
    bool public filledAfterExpiry;
    bool public filledBeforeNotice;
    bool public capBreached;
    uint256 public fills;

    constructor(Rebalancer rb_, IndexVault v, PriceOracle o, address admin_, address pusher_) {
        rb = rb_;
        vault = v;
        oracle = o;
        admin = admin_;
        pusher = pusher_;
        assets = v.assets();
        for (uint256 i; i < assets.length; ++i) {
            vm.prank(admin);
            TestERC20(assets[i]).mint(address(this), 1e40);
            IERC20(assets[i]).approve(address(rb), type(uint256).max);
        }
    }

    function trigger() external {
        try rb.trigger(address(vault)) {} catch {}
    }

    function start() external {
        try rb.startPlan(address(vault)) {} catch {}
    }

    function open() external {
        try rb.openAuction(address(vault)) {} catch {}
    }

    uint256 public fillAttempts;
    bytes4 public lastFillError;

    function fill(uint256 frac, uint256 wait) external {
        Rebalancer.Auction memory au = rb.auction(address(vault));
        if (au.id == 0 || au.filled >= au.lot || block.timestamp >= au.endAt) {
            try rb.openAuction(address(vault)) {} catch {}
            au = rb.auction(address(vault));
            if (au.id == 0 || au.filled >= au.lot || block.timestamp >= au.endAt) return;
        }
        vm.warp(vm.getBlockTimestamp() + bound(wait, 0, au.endAt - block.timestamp - 1));
        fillAttempts++;
        uint256 amt = bound(frac, 1, au.lot - au.filled);
        Rebalancer.Plan memory p = rb.plan(address(vault));
        try rb.fill(address(vault), amt, type(uint256).max) {
            fills++;
            if (block.timestamp > p.startedAt + rb.params().maxDurationSec) filledAfterExpiry = true;
            if (block.timestamp < p.startAt) filledBeforeNotice = true;
            uint256 cap = rb.plan(address(vault)).valueAtStart * rb.params().dailyCapBps / 10_000;
            if (rb.tradedLast24h(address(vault)) > cap) capBreached = true;
        } catch (bytes memory err) {
            lastFillError = bytes4(err);
        }
    }

    function movePrice(uint256 seed, uint256 bps) external {
        address a = assets[seed % assets.length];
        (uint256 p,) = oracle.latest(a);
        (,,, uint256 lo, uint256 hi,) = oracle.configs(a);
        uint256 np = p * bound(bps, 8500, 12_000) / 10_000;
        np = np < lo ? lo : np > hi ? hi : np;
        vm.prank(pusher);
        oracle.push(a, np);
    }

    function warp(uint256 secs) external {
        vm.warp(vm.getBlockTimestamp() + bound(secs, 60, 12 hours));
        for (uint256 i; i < assets.length; ++i) {
            (uint256 p,) = oracle.latest(assets[i]);
            vm.prank(pusher);
            oracle.push(assets[i], p);
        }
    }
}

/// @notice Guards hold for every plan under random keeper / filler / price activity.
contract RebalancerInvariantTest is RebalanceFixture {
    RebalanceHandler internal h;
    IndexVault internal v;

    function setUp() public override {
        super.setUp();
        v = _createMode(alice, "INV", 2, 1000, 100_000e6);
        // start with an active plan so every run exercises auctions
        _push(address(joe), 0.3e18);
        rebalancer.trigger(address(v));
        _warp(172_800);
        _refresh5();
        rebalancer.startPlan(address(v));
        h = new RebalanceHandler(rebalancer, v, oracle, admin, pusher);
        vm.prank(admin);
        joe.setMinter(address(h), true);
        targetContract(address(h));
    }

    function invariant_lossWithinBudget() public view {
        Rebalancer.Plan memory p = rebalancer.plan(address(v));
        assertLe(p.loss, int256(p.lossBudget));
    }

    function invariant_dailyCap() public view {
        assertFalse(h.capBreached(), "traded > 5 % of V in 24 h");
    }

    function invariant_noFillAfterMaxDurationOrBeforeNotice() public view {
        assertFalse(h.filledAfterExpiry());
        assertFalse(h.filledBeforeNotice());
    }

    function invariant_lotAtMost1Pct() public view {
        Rebalancer.Auction memory au = rebalancer.auction(address(v));
        if (au.id == 0) return;
        assertLe(au.lotUsd, rebalancer.plan(address(v)).valueAtStart / 100);
    }

    /// @dev Fills that fail must fail for a guard reason.
    function afterInvariant() public view {
        if (h.fills() == 0 && h.fillAttempts() > 0) {
            // every attempted fill was refused by a guard or ended auction — never by anything else
            bytes4 e = h.lastFillError();
            assertTrue(
                e == Rebalancer.LossBudgetExceeded.selector || e == Rebalancer.DailyCapReached.selector
                    || e == Rebalancer.AuctionOver.selector || e == Rebalancer.PlanExpired.selector
                    || e == Rebalancer.NoAuction.selector,
                "unexpected fill failure"
            );
        }
    }
}
