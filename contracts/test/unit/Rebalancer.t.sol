// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IndexFactory} from "../../src/core/IndexFactory.sol";
import {IndexLens} from "../../src/core/IndexLens.sol";
import {IndexVault} from "../../src/core/IndexVault.sol";
import {PriceOracle} from "../../src/oracle/PriceOracle.sol";
import {Rebalancer} from "../../src/rebalance/Rebalancer.sol";
import {TestERC20} from "../../src/test-tokens/TestERC20.sol";
import {RebalanceFixture} from "../utils/RebalanceFixture.sol";

contract RebalancerTest is RebalanceFixture {
    uint8 constant OFF = 0;
    uint8 constant MANUAL = 1;
    uint8 constant AUTO = 2;

    // ================================================================ registration + modes

    function test_register_modesAndDefaultDrift() public {
        IndexVault v = _createMode(alice, "AUT", AUTO, 0, 1000e6);
        (Rebalancer.IndexState memory s, Rebalancer.Mode m, uint32 d) = rebalancer.state(address(v));
        assertTrue(s.registered);
        assertEq(uint8(m), AUTO);
        assertEq(d, 5000);
        assertEq(s.creator, alice);
    }

    function test_register_driftRange() public {
        (address[] memory a, uint16[] memory w) = _assets5();
        IndexFactory.CreateParams memory p = _params("BAD", a, w, 1000e6, true);
        p.mode = AUTO;
        _fund(alice, 10_000e6);
        p.driftBps = 999;
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Rebalancer.BadDrift.selector, 999));
        factory.createAndBuy(p);
        p.driftBps = 20_001;
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Rebalancer.BadDrift.selector, 20_001));
        factory.createAndBuy(p);
        p.driftBps = 1000;
        vm.prank(alice);
        factory.createAndBuy(p);
        p.mode = 3;
        p.ticker = "BAD2";
        vm.prank(alice);
        vm.expectRevert(Rebalancer.BadMode.selector);
        factory.createAndBuy(p);
    }

    function test_mode_changeTakesEffectAfterDelay() public {
        IndexVault v = _createMode(alice, "MAN", MANUAL, 0, 1000e6);
        vm.prank(alice);
        rebalancer.requestMode(address(v), Rebalancer.Mode.Off, 0);
        (, Rebalancer.Mode m,) = rebalancer.state(address(v));
        assertEq(uint8(m), MANUAL);
        _warp(172_799);
        (, m,) = rebalancer.state(address(v));
        assertEq(uint8(m), MANUAL);
        _warp(1);
        (, m,) = rebalancer.state(address(v));
        assertEq(uint8(m), OFF);
        rebalancer.sync(address(v));
        (Rebalancer.IndexState memory s,,) = rebalancer.state(address(v));
        assertEq(uint8(s.mode), OFF);
    }

    function test_mode_autoToManualMustPassThroughOff() public {
        IndexVault v = _createMode(alice, "AUT", AUTO, 2000, 1000e6);
        vm.prank(alice);
        vm.expectRevert(Rebalancer.MustPassThroughOff.selector);
        rebalancer.requestMode(address(v), Rebalancer.Mode.Manual, 0);
        vm.prank(alice);
        rebalancer.requestMode(address(v), Rebalancer.Mode.Off, 0);
        // still Auto during the delay → Manual still refused
        vm.prank(alice);
        vm.expectRevert(Rebalancer.MustPassThroughOff.selector);
        rebalancer.requestMode(address(v), Rebalancer.Mode.Manual, 0);
        _warp(172_800);
        vm.prank(alice);
        rebalancer.requestMode(address(v), Rebalancer.Mode.Manual, 0);
        _warp(172_800);
        (, Rebalancer.Mode m,) = rebalancer.state(address(v));
        assertEq(uint8(m), MANUAL);
    }

    function test_mode_manualToAutoDirect() public {
        IndexVault v = _createMode(alice, "MAN", MANUAL, 0, 1000e6);
        vm.prank(alice);
        rebalancer.requestMode(address(v), Rebalancer.Mode.Auto, 3000);
        _warp(172_800);
        (, Rebalancer.Mode m, uint32 d) = rebalancer.state(address(v));
        assertEq(uint8(m), AUTO);
        assertEq(d, 3000);
    }

    function test_mode_onlyCreator() public {
        IndexVault v = _createMode(alice, "MAN", MANUAL, 0, 1000e6);
        vm.prank(bob);
        vm.expectRevert(Rebalancer.NotCreator.selector);
        rebalancer.requestMode(address(v), Rebalancer.Mode.Off, 0);
    }

    // ================================================================ Manual versions

    function _w(uint16 a, uint16 b, uint16 c, uint16 d, uint16 e) internal pure returns (uint16[] memory w) {
        w = new uint16[](5);
        (w[0], w[1], w[2], w[3], w[4]) = (a, b, c, d, e);
    }

    function test_version_publishNoticeAndStart() public {
        IndexVault v = _createMode(alice, "MAN", MANUAL, 0, 10_000e6);
        uint16[] memory w = _w(3000, 2000, 2000, 2000, 1000);
        vm.expectEmit(true, false, false, true);
        emit Rebalancer.VersionPublished(address(v), 2, w, "rotate into AVAX", uint64(block.timestamp + 172_800));
        vm.prank(alice);
        assertEq(rebalancer.publishVersion(address(v), w, "rotate into AVAX"), 2);

        // one plan at a time
        vm.prank(alice);
        vm.expectRevert(Rebalancer.PlanInProgress.selector);
        rebalancer.publishVersion(address(v), w, "again");

        // notice guard
        vm.expectRevert(abi.encodeWithSelector(Rebalancer.TooEarly.selector, uint64(block.timestamp + 172_800)));
        rebalancer.startPlan(address(v));
        assertEq(v.targetWeights()[0], 2000, "targets unchanged before start");

        _warp(172_800);
        _refresh5();
        rebalancer.startPlan(address(v));
        assertEq(v.targetWeights()[0], 3000);
        Rebalancer.Plan memory p = rebalancer.plan(address(v));
        assertEq(uint8(p.status), uint8(Rebalancer.Status.Active));
        assertTrue(p.manual);
        assertEq(p.version, 2);
        assertGt(p.buyRem[0], 0);
        assertGt(p.sellRem[4], 0);
        assertEq(p.lossBudget, p.valueAtStart / 100);
    }

    function test_version_validation() public {
        IndexVault v = _createMode(alice, "MAN", MANUAL, 0, 1000e6);
        vm.startPrank(alice);
        vm.expectRevert(Rebalancer.BadWeights.selector);
        rebalancer.publishVersion(address(v), _w(99, 2901, 2000, 2000, 3000), "x");
        vm.expectRevert(Rebalancer.BadWeights.selector);
        rebalancer.publishVersion(address(v), _w(2000, 2000, 2000, 2000, 2001), "x");
        uint16[] memory four = new uint16[](4);
        vm.expectRevert(Rebalancer.BadWeights.selector);
        rebalancer.publishVersion(address(v), four, "x");
        vm.stopPrank();
        vm.prank(bob);
        vm.expectRevert(Rebalancer.NotCreator.selector);
        rebalancer.publishVersion(address(v), _w(2000, 2000, 2000, 2000, 2000), "x");
    }

    function test_version_onlyInManual() public {
        IndexVault v = _createMode(alice, "AUT", AUTO, 0, 1000e6);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Rebalancer.WrongMode.selector, Rebalancer.Mode.Auto));
        rebalancer.publishVersion(address(v), _w(2000, 2000, 2000, 2000, 2000), "x");
    }

    // ================================================================ Auto trigger

    function test_auto_triggerOnDrift() public {
        IndexVault v = _createMode(alice, "AUT", AUTO, 2000, 1000e6);
        vm.expectRevert(Rebalancer.NotDue.selector);
        rebalancer.trigger(address(v));
        _push(address(joe), 0.28e18); // +40 %
        (bool due, uint256 drift) = rebalancer.isDue(address(v));
        assertTrue(due);
        assertGt(drift, 2000);
        vm.prank(bob); // anyone
        rebalancer.trigger(address(v));
        assertEq(uint8(rebalancer.plan(address(v)).status), uint8(Rebalancer.Status.Scheduled));
    }

    function test_auto_relativeDriftBelowThetaNotDue() public {
        IndexVault v = _createMode(alice, "AUT", AUTO, 5000, 1000e6);
        _push(address(joe), 0.28e18); // drift ≈ 30 % < 50 %
        (bool due,) = rebalancer.isDue(address(v));
        assertFalse(due);
    }

    function test_auto_triggerOnInterval() public {
        IndexVault v = _createMode(alice, "AUT", AUTO, 5000, 1000e6);
        _warp(30 days);
        _refresh5();
        (bool due,) = rebalancer.isDue(address(v));
        assertTrue(due);
        rebalancer.trigger(address(v));
    }

    function test_off_noTriggers() public {
        IndexVault v = _createMode(alice, "OFF", OFF, 0, 1000e6);
        _push(address(joe), 1.9e18);
        (bool due,) = rebalancer.isDue(address(v));
        assertFalse(due);
        vm.expectRevert(Rebalancer.NotDue.selector);
        rebalancer.trigger(address(v));
    }

    // ================================================================ auctions

    function _activeAuto() internal returns (IndexVault v) {
        v = _createMode(alice, "AUT", AUTO, 2000, 100_000e6);
        _push(address(joe), 0.28e18);
        rebalancer.trigger(address(v));
        _warp(172_800);
        _refresh5();
        rebalancer.startPlan(address(v));
    }

    function test_auction_dutchPrice() public {
        IndexVault v = _activeAuto();
        rebalancer.openAuction(address(v));
        Rebalancer.Auction memory au = rebalancer.auction(address(v));
        assertEq(v.assets()[au.sellIdx], address(joe));
        assertEq(au.startPrice, au.refPrice * 10_050 / 10_000);
        assertEq(au.floorPrice, au.refPrice * 9800 / 10_000);
        assertEq(rebalancer.currentPrice(address(v)), au.startPrice);
        _warp(1350);
        assertApproxEqAbs(rebalancer.currentPrice(address(v)), (au.startPrice + au.floorPrice) / 2, 1);
        _warp(1350);
        assertEq(rebalancer.currentPrice(address(v)), au.floorPrice);
        _warp(10 hours);
        assertEq(rebalancer.currentPrice(address(v)), au.floorPrice, "never below floor");
    }

    function test_auction_lotAtMost1PctOfV() public {
        IndexVault v = _activeAuto();
        rebalancer.openAuction(address(v));
        Rebalancer.Auction memory au = rebalancer.auction(address(v));
        Rebalancer.Plan memory p = rebalancer.plan(address(v));
        (uint256 pj,) = oracle.latest(address(joe));
        uint256 lotUsd = au.lot * pj / 1e18;
        assertLe(lotUsd, p.valueAtStart / 100);
        assertApproxEqRel(lotUsd, p.valueAtStart / 100, 1e12);
    }

    function test_auction_partialFillsAndExceeds() public {
        IndexVault v = _activeAuto();
        rebalancer.openAuction(address(v));
        Rebalancer.Auction memory au = rebalancer.auction(address(v));
        address aj = v.assets()[au.buyIdx];
        vm.prank(admin);
        TestERC20(aj).mint(filler, 1e30);
        vm.startPrank(filler);
        IERC20(aj).approve(address(rebalancer), type(uint256).max);
        uint256 joeBefore = joe.balanceOf(filler);
        uint256 vaultJ = IERC20(aj).balanceOf(address(v));
        uint256 pay = rebalancer.fill(address(v), au.lot / 3, type(uint256).max);
        assertEq(joe.balanceOf(filler) - joeBefore, au.lot / 3);
        assertEq(IERC20(aj).balanceOf(address(v)) - vaultJ, pay);
        rebalancer.fill(address(v), au.lot / 3, type(uint256).max);
        vm.expectPartialRevert(Rebalancer.Exceeds.selector);
        rebalancer.fill(address(v), au.lot, type(uint256).max);
        vm.expectPartialRevert(Rebalancer.Slippage.selector);
        rebalancer.fill(address(v), 1e18, 1);
        vm.stopPrank();
        vm.expectRevert(Rebalancer.AuctionLive.selector);
        rebalancer.openAuction(address(v));
    }

    function test_auction_mostlyFailedLotRetriedAtHalf() public {
        IndexVault v = _activeAuto();
        rebalancer.openAuction(address(v));
        uint256 lot1 = rebalancer.auction(address(v)).lot;
        _warp(2700); // ends unfilled
        vm.expectRevert(Rebalancer.AuctionOver.selector);
        rebalancer.fill(address(v), 1, type(uint256).max);
        _refresh5();
        rebalancer.openAuction(address(v));
        assertApproxEqRel(rebalancer.auction(address(v)).lot, lot1 / 2, 1e12);
        assertEq(rebalancer.plan(address(v)).lotDivisor, 2);
    }

    function test_guard_dailyCap5Pct() public {
        // bigger shock so the plan needs more than 5 % of V
        IndexVault v = _createMode(alice, "AUT", AUTO, 2000, 100_000e6);
        _push(address(joe), 0.6e18);
        rebalancer.trigger(address(v));
        _warp(172_800);
        _refresh5();
        rebalancer.startPlan(address(v));
        uint256 cap = rebalancer.plan(address(v)).valueAtStart * 500 / 10_000;
        bool capped;
        for (uint256 k; k < 20; ++k) {
            try rebalancer.openAuction(address(v)) {}
            catch (bytes memory err) {
                assertEq(bytes4(err), Rebalancer.DailyCapReached.selector);
                capped = true;
                break;
            }
            _fillAll(v, 600);
            assertLe(rebalancer.tradedLast24h(address(v)), cap, "never above 5 % of V per 24 h");
            _warp(60);
            _refresh5();
        }
        assertTrue(capped, "cap reached");
        assertGt(rebalancer.tradedLast24h(address(v)), cap * 99 / 100);
        _warp(25 hours);
        _refresh5();
        rebalancer.openAuction(address(v));
        assertEq(rebalancer.tradedLast24h(address(v)), 0);
    }

    function test_guard_lossBudgetStopsPlan() public {
        IndexVault v = _activeAuto();
        // fills at the floor lose 2 % of each lot; budget is 1 % of V → about 50 % of V of lots at most,
        // but daily cap (5 %) and remaining amount bound it first, so force losses by a price move instead.
        rebalancer.openAuction(address(v));
        Rebalancer.Auction memory au = rebalancer.auction(address(v));
        // JOE jumps after the auction opened: filling at the stale auction ref is a big loss
        _push(address(joe), 1e18);
        address aj = v.assets()[au.buyIdx];
        vm.prank(admin);
        TestERC20(aj).mint(filler, 1e30);
        vm.startPrank(filler);
        IERC20(aj).approve(address(rebalancer), type(uint256).max);
        vm.expectPartialRevert(Rebalancer.LossBudgetExceeded.selector);
        rebalancer.fill(address(v), au.lot, type(uint256).max);
        vm.stopPrank();
        Rebalancer.Plan memory p = rebalancer.plan(address(v));
        assertLe(p.loss, int256(p.lossBudget));
    }

    function test_guard_lossBudgetWorstCaseRefusesLot() public {
        IndexVault v = _activeAuto();
        // burn most of the budget with floor fills, then the next lot's worst case no longer fits
        uint256 n;
        while (uint8(rebalancer.plan(address(v)).status) == uint8(Rebalancer.Status.Active) && n < 40) {
            try rebalancer.openAuction(address(v)) {}
            catch {
                _warp(25 hours);
                _refresh5();
                continue;
            }
            if (uint8(rebalancer.plan(address(v)).status) != uint8(Rebalancer.Status.Active)) break;
            _fillAll(v, 2700 - 1); // at (almost) the floor
            _warp(1);
            _refresh5();
            ++n;
        }
        Rebalancer.Plan memory p = rebalancer.plan(address(v));
        assertLe(p.loss, int256(p.lossBudget), "loss within budget");
        assertTrue(
            p.status == Rebalancer.Status.Stopped || p.status == Rebalancer.Status.Completed, "plan ended by guard"
        );
    }

    function test_guard_maxDuration() public {
        IndexVault v = _activeAuto();
        rebalancer.openAuction(address(v));
        _fillAll(v, 600);
        uint256 joeInVault = joe.balanceOf(address(v));
        _warp(14 days + 1);
        _refresh5();
        vm.expectRevert(Rebalancer.PlanExpired.selector);
        rebalancer.fill(address(v), 1, type(uint256).max);
        assertEq(rebalancer.openAuction(address(v)), 0);
        assertEq(uint8(rebalancer.plan(address(v)).status), uint8(Rebalancer.Status.Expired));
        assertEq(joe.balanceOf(address(v)), joeInVault, "filled trades stay");
    }

    function test_guard_stalePricesBlockAuctions() public {
        IndexVault v = _createMode(alice, "AUT", AUTO, 2000, 10_000e6);
        _push(address(joe), 0.28e18);
        rebalancer.trigger(address(v));
        _warp(172_800); // everything stale
        vm.expectPartialRevert(PriceOracle.PriceStale.selector);
        rebalancer.startPlan(address(v));
        _refresh5();
        rebalancer.startPlan(address(v));
        rebalancer.openAuction(address(v));
        _warp(3601);
        // auction ended anyway; open a new one with stale prices
        vm.expectPartialRevert(PriceOracle.PriceStale.selector);
        rebalancer.openAuction(address(v));
        // redeem still works
        vm.prank(alice);
        v.redeem(1e18, alice, new address[](0));
    }

    function test_staleFillReverts() public {
        IndexVault v = _activeAuto();
        rebalancer.openAuction(address(v));
        _warp(1000);
        // make JOE stale only: refresh others
        _refreshAll();
        _warp(2601);
        _refreshAll();
        address aj = v.assets()[rebalancer.auction(address(v)).buyIdx];
        vm.prank(admin);
        TestERC20(aj).mint(filler, 1e30);
        vm.startPrank(filler);
        IERC20(aj).approve(address(rebalancer), type(uint256).max);
        vm.expectRevert(); // AuctionOver or PriceStale — both block the fill
        rebalancer.fill(address(v), 1e18, type(uint256).max);
        vm.stopPrank();
    }

    function test_offCancelsPlan() public {
        IndexVault v = _activeAuto();
        vm.prank(alice);
        rebalancer.requestMode(address(v), Rebalancer.Mode.Off, 0);
        _warp(172_800);
        rebalancer.sync(address(v));
        assertEq(uint8(rebalancer.plan(address(v)).status), uint8(Rebalancer.Status.Cancelled));
    }

    function test_onlyRebalancerMovesVaultAssets() public {
        IndexVault v = _createMode(alice, "MAN", MANUAL, 0, 1000e6);
        vm.expectRevert(IndexVault.OnlyRebalancer.selector);
        v.rebalanceTransfer(address(joe), 1, alice);
        uint16[] memory w = _w(2000, 2000, 2000, 2000, 2000);
        vm.prank(alice);
        vm.expectRevert(IndexVault.OnlyRebalancer.selector);
        v.setTargetWeights(w);
    }

    function test_auctionPriceNeverEntersBuySellRedeem() public {
        IndexVault v = _activeAuto();
        (uint256 unitsBefore,) = lens.previewBuy(address(v), 1000e6);
        rebalancer.openAuction(address(v));
        _warp(2000); // auction price near floor
        (uint256 unitsDuring,) = lens.previewBuy(address(v), 1000e6);
        assertEq(unitsDuring, unitsBefore);
        uint256 got = _buy(v, bob, 1000e6);
        assertEq(got, unitsBefore);
    }
}
