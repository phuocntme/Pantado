// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AssetRegistry} from "../../src/core/AssetRegistry.sol";
import {IndexFactory} from "../../src/core/IndexFactory.sol";
import {IndexLens} from "../../src/core/IndexLens.sol";
import {IndexVault} from "../../src/core/IndexVault.sol";
import {PriceOracle} from "../../src/oracle/PriceOracle.sol";
import {Fixture} from "../utils/Fixture.sol";

contract IndexCoreTest is Fixture {
    // ================================================================ create + level

    function test_firstBuy_levelStartsAt100() public {
        (IndexVault v, uint256 units) = _create(alice, "TBB", 1000e6, true);
        assertApproxEqAbs(lens.level(address(v)), 100e18, 1e6, "level 100");
        assertEq(v.balanceOf(v.DEAD()), 0.01e18, "dead units");
        assertEq(v.balanceOf(alice), units);
        assertEq(v.totalSupply(), units + 0.01e18);
        // 1000 USDC − 0.5 % fee − 0.3 % venue spread ≈ 992.015 USD → 9.92015 units total
        assertApproxEqRel(v.totalSupply(), 9.92015e18, 1e12);
        assertEq(v.name(), "Test index");
        assertEq(v.symbol(), "TBB");
        assertEq(v.creator(), alice);
    }

    function test_firstBuy_spendsByTargetWeight() public {
        (IndexVault v,) = _create(alice, "TBB", 1000e6, true);
        IndexLens.Basket memory k = lens.basket(address(v));
        assertApproxEqAbs(k.currentBps[0], 2000, 1);
        assertApproxEqAbs(k.currentBps[1], 5000, 1);
        assertApproxEqAbs(k.currentBps[2], 3000, 1);
        assertLt(k.maxDriftBps, 5);
    }

    function test_create_chargesCreationFeeToTreasury() public {
        uint256 before = usdc.balanceOf(treasury);
        _create(alice, "TBB", 100e6, true);
        // 5 USDC creation + 30/50 of the 0.5 USDC trade fee
        assertEq(usdc.balanceOf(treasury) - before, 5e6 + 0.3e6);
        assertEq(splitter.earnings(alice), 0.2e6);
    }

    function test_create_minFirstBuy() public {
        (address[] memory a, uint16[] memory w) = _assets3();
        _fund(alice, 1000e6);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IndexFactory.FirstBuyTooSmall.selector, 99e6, 100e6));
        factory.createAndBuy(_params("TBB", a, w, 99e6, true));
    }

    function test_create_tickerRules() public view {
        assertTrue(factory.isValidTicker("AB"));
        assertTrue(factory.isValidTicker("MAG7"));
        assertTrue(factory.isValidTicker("ABCDEF"));
        assertFalse(factory.isValidTicker("A"));
        assertFalse(factory.isValidTicker("ABCDEFG"));
        assertFalse(factory.isValidTicker("ab"));
        assertFalse(factory.isValidTicker("A-B"));
        assertFalse(factory.isValidTicker(""));
    }

    function test_create_tickerUnique() public {
        _create(alice, "TBB", 100e6, true);
        (address[] memory a, uint16[] memory w) = _assets3();
        _fund(bob, 1000e6);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IndexFactory.TickerTaken.selector, "TBB"));
        factory.createAndBuy(_params("TBB", a, w, 100e6, true));
        assertTrue(factory.isTickerTaken("TBB"));
    }

    function test_create_weightsAtLeast1PctAndSum100() public {
        (address[] memory a, uint16[] memory w) = _assets3();
        _fund(alice, 10_000e6);
        vm.startPrank(alice);
        w[0] = 99;
        w[1] = 5901;
        vm.expectRevert(IndexFactory.BadWeights.selector);
        factory.createAndBuy(_params("AAA", a, w, 100e6, true));
        (a, w) = _assets3();
        w[0] = 2001;
        vm.expectRevert(IndexFactory.BadWeights.selector);
        factory.createAndBuy(_params("AAA", a, w, 100e6, true));
        (a, w) = _assets3();
        w[0] = 100;
        w[1] = 6900;
        factory.createAndBuy(_params("AAA", a, w, 100e6, true));
        vm.stopPrank();
    }

    function test_create_assetCount2to20() public {
        _fund(alice, 10_000e6);
        address[] memory one = new address[](1);
        one[0] = address(wavax);
        uint16[] memory w1 = new uint16[](1);
        w1[0] = 10_000;
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IndexFactory.BadAssetCount.selector, 1));
        factory.createAndBuy(_params("ONE", one, w1, 100e6, true));

        // 21 assets: list 17 more tokens
        address[] memory many = new address[](21);
        uint16[] memory wm = new uint16[](21);
        for (uint256 i; i < 21; ++i) {
            many[i] = _newToken(i);
            wm[i] = i == 0 ? 10_000 - 20 * 476 : 476;
        }
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IndexFactory.BadAssetCount.selector, 21));
        factory.createAndBuy(_params("MANY", many, wm, 100e6, true));

        address[] memory twenty = new address[](20);
        uint16[] memory w20 = new uint16[](20);
        for (uint256 i; i < 20; ++i) {
            twenty[i] = many[i];
            w20[i] = 500;
        }
        vm.prank(alice);
        (address idx,) = factory.createAndBuy(_params("TWENTY", twenty, w20, 1000e6, true));
        assertEq(IndexVault(idx).assetCount(), 20);
        assertApproxEqAbs(lens.level(idx), 100e18, 1e6);
    }

    function test_create_rejectsUnlistedDuplicateAndQuote() public {
        (address[] memory a, uint16[] memory w) = _assets3();
        _fund(alice, 10_000e6);
        a[2] = address(usdc);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IndexFactory.UnlistedAsset.selector, address(usdc)));
        factory.createAndBuy(_params("AAA", a, w, 100e6, true));
        a[2] = a[0];
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IndexFactory.DuplicateAsset.selector, a[0]));
        factory.createAndBuy(_params("AAA", a, w, 100e6, true));
    }

    function test_create_atomic_staleRevertsEverything() public {
        _warp(3601);
        (address[] memory a, uint16[] memory w) = _assets3();
        _fund(alice, 1000e6);
        uint256 bal = usdc.balanceOf(alice);
        vm.prank(alice);
        vm.expectRevert();
        factory.createAndBuy(_params("TBB", a, w, 100e6, true));
        assertEq(factory.indexCount(), 0);
        assertFalse(factory.isTickerTaken("TBB"));
        assertEq(usdc.balanceOf(alice), bal);
    }

    // ================================================================ buy

    function test_buy_keepsProportions() public {
        (IndexVault v,) = _create(alice, "TBB", 1000e6, true);
        // move prices so current weights differ from targets
        _push(address(btcb), 90_000e18);
        _push(address(wavax), 5e18);
        uint256[] memory b0 = v.balances();
        uint256 s0 = v.totalSupply();
        IndexLens.Basket memory k0 = lens.basket(address(v));
        _buy(v, bob, 5000e6);
        IndexLens.Basket memory k1 = lens.basket(address(v));
        uint256[] memory b1 = v.balances();
        uint256 s1 = v.totalSupply();
        for (uint256 i; i < 3; ++i) {
            // current weights unchanged (buy follows the basket, not the targets)
            assertApproxEqAbs(k1.currentBps[i], k0.currentBps[i], 1);
            // per-unit holdings never decrease
            assertGe(b1[i] * s0, b0[i] * s1);
        }
    }

    function test_buy_unitsAtMostMinRatio() public {
        (IndexVault v,) = _create(alice, "TBB", 1000e6, true);
        uint256[] memory b0 = v.balances();
        uint256 s0 = v.totalSupply();
        uint256 units = _buy(v, bob, 777e6);
        uint256[] memory b1 = v.balances();
        for (uint256 i; i < 3; ++i) {
            uint256 q = b1[i] - b0[i];
            assertLe(units, s0 * q / b0[i]);
        }
    }

    function test_buy_matchesPreview() public {
        (IndexVault v,) = _create(alice, "TBB", 1000e6, true);
        (uint256 expected, uint256 fee) = lens.previewBuy(address(v), 1234e6);
        assertEq(fee, 1234e6 * 50 / 10_000);
        assertEq(_buy(v, bob, 1234e6), expected);
    }

    function test_buy_levelUnchangedBySpreadOnlyMinusCosts() public {
        (IndexVault v,) = _create(alice, "TBB", 1000e6, true);
        uint256 l0 = lens.level(address(v));
        _buy(v, bob, 10_000e6);
        // buyers pay the spread and fee, holders are never diluted
        assertGe(lens.level(address(v)), l0 - 1e6);
    }

    function test_buy_minUnitsSlippage() public {
        (IndexVault v,) = _create(alice, "TBB", 1000e6, true);
        vm.prank(admin);
        usdc.mint(bob, 100e6);
        vm.startPrank(bob);
        usdc.approve(address(v), 100e6);
        vm.expectRevert();
        v.buy(100e6, 100e18, bob);
        vm.stopPrank();
    }

    function test_buy_staleReverts() public {
        (IndexVault v,) = _create(alice, "TBB", 1000e6, true);
        _warp(3601);
        vm.prank(admin);
        usdc.mint(bob, 100e6);
        vm.startPrank(bob);
        usdc.approve(address(v), 100e6);
        vm.expectPartialRevert(PriceOracle.PriceStale.selector);
        v.buy(100e6, 0, bob);
        vm.stopPrank();
    }

    function test_buy_pausedAssetReverts() public {
        (IndexVault v,) = _create(alice, "TBB", 1000e6, true);
        vm.prank(admin);
        registry.setBuysPaused(address(btcb), true);
        vm.prank(admin);
        usdc.mint(bob, 100e6);
        vm.startPrank(bob);
        usdc.approve(address(v), 100e6);
        vm.expectRevert(abi.encodeWithSelector(IndexVault.BuysPausedFor.selector, address(btcb)));
        v.buy(100e6, 0, bob);
        vm.stopPrank();
    }

    // ================================================================ sell

    function test_sell_proRataAndFee() public {
        (IndexVault v, uint256 units) = _create(alice, "TBB", 1000e6, true);
        uint256[] memory b0 = v.balances();
        uint256 s0 = v.totalSupply();
        uint256 sellUnits = units / 3;
        (uint256 expected, uint256 fee) = lens.previewSell(address(v), sellUnits);
        uint256 earnBefore = splitter.earnings(alice);
        vm.prank(alice);
        uint256 out = v.sell(sellUnits, 0, alice);
        assertEq(out, expected);
        uint256[] memory b1 = v.balances();
        for (uint256 i; i < 3; ++i) {
            assertEq(b0[i] - b1[i], b0[i] * sellUnits / s0);
        }
        assertEq(splitter.earnings(alice) - earnBefore, fee * 20 / 50);
        // round trip loses fee + spread twice, about 1.6 %
        assertApproxEqRel(out, 1000e6 * uint256(sellUnits) / (units + 0.01e18) * 984 / 1000, 0.01e18);
    }

    function test_sell_staleReverts() public {
        (IndexVault v, uint256 units) = _create(alice, "TBB", 1000e6, true);
        _warp(3601);
        vm.prank(alice);
        vm.expectPartialRevert(PriceOracle.PriceStale.selector);
        v.sell(units / 2, 0, alice);
    }

    function test_sell_minOut() public {
        (IndexVault v, uint256 units) = _create(alice, "TBB", 1000e6, true);
        vm.prank(alice);
        vm.expectPartialRevert(IndexVault.Slippage.selector);
        v.sell(units, 1000e6, alice);
    }

    // ================================================================ redeem

    function test_redeem_proRata() public {
        (IndexVault v, uint256 units) = _create(alice, "TBB", 1000e6, true);
        uint256[] memory b0 = v.balances();
        uint256 s0 = v.totalSupply();
        vm.prank(alice);
        uint256[] memory out = v.redeem(units / 4, bob, new address[](0));
        for (uint256 i; i < 3; ++i) {
            assertEq(out[i], b0[i] * (units / 4) / s0);
        }
        assertEq(btcb.balanceOf(bob), out[1]);
        assertEq(v.balanceOf(alice), units - units / 4);
    }

    function test_redeem_worksWhenStale() public {
        (IndexVault v, uint256 units) = _create(alice, "TBB", 1000e6, true);
        _warp(30 days);
        assertFalse(oracle.isFresh(address(btcb)));
        vm.prank(alice);
        uint256[] memory out = v.redeem(units, alice, new address[](0));
        assertGt(out[0], 0);
        assertEq(v.balanceOf(alice), 0);
        assertEq(v.totalSupply(), 0.01e18, "only dead units remain");
    }

    function test_redeem_worksWhenBuysPaused() public {
        (IndexVault v, uint256 units) = _create(alice, "TBB", 1000e6, true);
        vm.startPrank(admin);
        registry.setBuysPaused(address(wavax), true);
        registry.setBuysPaused(address(btcb), true);
        vm.stopPrank();
        vm.prank(alice);
        v.redeem(units, alice, new address[](0));
        assertEq(v.balanceOf(alice), 0);
    }

    function test_redeem_forfeitSkipsAsset() public {
        (IndexVault v, uint256 units) = _create(alice, "TBB", 1000e6, true);
        address[] memory f = new address[](1);
        f[0] = address(btcb);
        uint256 btcBefore = v.balances()[1];
        vm.prank(alice);
        uint256[] memory out = v.redeem(units / 2, alice, f);
        assertEq(out[1], 0);
        assertEq(btcb.balanceOf(alice), 0);
        assertEq(v.balances()[1], btcBefore, "forfeited BTC.b stays for holders");
        assertGt(out[0], 0);
    }

    function test_redeem_noFee() public {
        (IndexVault v, uint256 units) = _create(alice, "TBB", 1000e6, true);
        uint256 t = usdc.balanceOf(treasury);
        uint256 e = splitter.earnings(alice);
        vm.prank(alice);
        v.redeem(units, alice, new address[](0));
        assertEq(usdc.balanceOf(treasury), t);
        assertEq(splitter.earnings(alice), e);
    }

    function test_redeem_cannotRedeemMoreThanBalance() public {
        (IndexVault v, uint256 units) = _create(alice, "TBB", 1000e6, true);
        vm.prank(alice);
        vm.expectRevert();
        v.redeem(units + 1, alice, new address[](0));
    }

    // ================================================================ fees + visibility

    function test_fees_splitExactly() public {
        (IndexVault v,) = _create(alice, "TBB", 1000e6, true);
        uint256 t0 = usdc.balanceOf(treasury);
        uint256 e0 = splitter.earnings(alice);
        _buy(v, bob, 333_333_333);
        uint256 fee = uint256(333_333_333) * 50 / 10_000;
        uint256 dt = usdc.balanceOf(treasury) - t0;
        uint256 de = splitter.earnings(alice) - e0;
        assertEq(dt + de, fee);
        assertEq(de, fee * 20 / 50);
    }

    function test_fees_privateIndexAllToProtocol() public {
        (IndexVault v,) = _create(alice, "PRIV", 1000e6, false);
        assertEq(splitter.earnings(alice), 0);
        uint256 t0 = usdc.balanceOf(treasury);
        _buy(v, bob, 1000e6);
        assertEq(usdc.balanceOf(treasury) - t0, 5e6);
        assertEq(splitter.earnings(alice), 0);
    }

    function test_fees_creatorClaims() public {
        (IndexVault v,) = _create(alice, "TBB", 1000e6, true);
        _buy(v, bob, 1000e6);
        uint256 owed = splitter.earnings(alice);
        assertEq(owed, 2e6 + 2e6);
        vm.prank(alice);
        splitter.claim(alice);
        assertEq(usdc.balanceOf(alice), owed);
        assertEq(splitter.earnings(alice), 0);
        vm.prank(alice);
        assertEq(splitter.claim(alice), 0);
    }

    function test_fees_onlyIndexesAccrue() public {
        vm.expectPartialRevert(bytes4(keccak256("NotIndex(address)")));
        splitter.accrue(1);
    }

    function test_visibility_privateToPublicOnlyByCreator() public {
        (IndexVault v,) = _create(alice, "PRIV", 1000e6, false);
        (, bool isPublic,) = factory.indexInfo(address(v));
        assertFalse(isPublic);
        vm.prank(bob);
        vm.expectRevert(IndexFactory.NotCreator.selector);
        factory.makePublic(address(v));
        vm.prank(alice);
        factory.makePublic(address(v));
        (, isPublic,) = factory.indexInfo(address(v));
        assertTrue(isPublic);
        vm.prank(alice);
        vm.expectRevert(IndexFactory.AlreadyPublic.selector);
        factory.makePublic(address(v));
        // creator share accrues once public
        _buy(v, bob, 1000e6);
        assertEq(splitter.earnings(alice), 2e6);
    }

    // ================================================================ oracle

    function test_oracle_bandsAndRoles() public {
        vm.prank(pusher);
        vm.expectPartialRevert(PriceOracle.PriceOutOfBand.selector);
        oracle.push(address(btcb), 1e18);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(PriceOracle.NotPusher.selector, bob));
        oracle.push(address(btcb), 70_000e18);
        vm.prank(pusher);
        vm.expectRevert(abi.encodeWithSelector(PriceOracle.FixedPriceAsset.selector, address(usdc)));
        oracle.push(address(usdc), 1e18);
    }

    function test_oracle_staleness() public {
        assertTrue(oracle.isFresh(address(btcb)));
        _warp(3600);
        assertTrue(oracle.isFresh(address(btcb)));
        _warp(1);
        assertFalse(oracle.isFresh(address(btcb)));
        vm.expectPartialRevert(PriceOracle.PriceStale.selector);
        oracle.getPrice(address(btcb));
        assertEq(oracle.getPrice(address(usdc)), 1e18, "fixed never stale");
    }

    function test_oracle_chainlinkFeed() public {
        MockFeed feed = new MockFeed();
        feed.set(70_000e8, block.timestamp);
        vm.prank(admin);
        oracle.setFeed(address(btcb), address(feed));
        assertEq(oracle.getPrice(address(btcb)), 70_000e18);
        vm.prank(pusher);
        vm.expectRevert(abi.encodeWithSelector(PriceOracle.FeedAsset.selector, address(btcb)));
        oracle.push(address(btcb), 70_000e18);
        feed.set(1e8, block.timestamp); // out of band → treated as no price
        assertFalse(oracle.isFresh(address(btcb)));
    }

    // ================================================================ venue

    function test_tokenVenue_quoteEqualsSwap() public {
        uint256 q = venue.quote(address(usdc), address(btcb), 1000e6);
        vm.startPrank(admin);
        usdc.mint(admin, 1000e6);
        usdc.approve(address(venue), 1000e6);
        uint256 out = venue.swapExactIn(address(usdc), address(btcb), 1000e6, q, admin);
        vm.stopPrank();
        assertEq(out, q);
        // 1000 × 0.997 / 74 357 BTC
        assertEq(q, uint256(997e18) * 1e8 / 74_357e18);
    }

    // ================================================================ helpers

    function _newToken(uint256 i) internal returns (address t) {
        if (i == 0) return address(wavax);
        if (i == 1) return address(btcb);
        if (i == 2) return address(wethe);
        if (i == 3) return address(six);
        vm.startPrank(admin);
        TestERC20Like tok = TestERC20Like(address(new MintableToken()));
        oracle.configureAsset(address(tok), 3600, 1e17, 1e20);
        registry.list(address(tok), AssetRegistry.Kind.Token, address(venue));
        venue.setMarket(address(tok), SPREAD);
        tok.mint(address(venue), 1e30);
        vm.stopPrank();
        _push(address(tok), 1e18 + i * 1e16);
        t = address(tok);
    }
}

interface TestERC20Like {
    function mint(address to, uint256 amount) external;
}

contract MintableToken {
    string public name = "T";
    string public symbol = "T";
    uint8 public decimals = 18;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 a) external {
        balanceOf[to] += a;
    }

    function approve(address s, uint256 a) external returns (bool) {
        allowance[msg.sender][s] = a;
        return true;
    }

    function transfer(address to, uint256 a) external returns (bool) {
        balanceOf[msg.sender] -= a;
        balanceOf[to] += a;
        return true;
    }

    function transferFrom(address f, address to, uint256 a) external returns (bool) {
        allowance[f][msg.sender] -= a;
        balanceOf[f] -= a;
        balanceOf[to] += a;
        return true;
    }
}

contract MockFeed {
    int256 internal answer;
    uint256 internal updated;

    function set(int256 a, uint256 t) external {
        answer = a;
        updated = t;
    }

    function decimals() external pure returns (uint8) {
        return 8;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, updated, updated, 1);
    }
}
