// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AssetRegistry} from "../../src/core/AssetRegistry.sol";
import {IndexFactory} from "../../src/core/IndexFactory.sol";
import {IndexVault} from "../../src/core/IndexVault.sol";
import {Rebalancer} from "../../src/rebalance/Rebalancer.sol";
import {TestERC20} from "../../src/test-tokens/TestERC20.sol";
import {Fixture} from "./Fixture.sol";

/// @notice Fixture + Rebalancer with production parameters (contracts/config/params.json) and a 5th token.
abstract contract RebalanceFixture is Fixture {
    Rebalancer internal rebalancer;
    TestERC20 internal joe;
    address internal filler = makeAddr("filler");

    function setUp() public virtual override {
        super.setUp();
        vm.startPrank(admin);
        rebalancer = new Rebalancer(address(factory), address(oracle), defaultParams());
        factory.setRebalancer(address(rebalancer));
        joe = new TestERC20("JOE", "JOE", 18, admin);
        oracle.configureAsset(address(joe), 3600, 0.02e18, 2e18);
        registry.list(address(joe), AssetRegistry.Kind.Token, address(venue));
        venue.setMarket(address(joe), SPREAD);
        joe.mint(address(venue), 1e27);
        vm.stopPrank();
        _push(address(joe), 0.2e18);
    }

    function defaultParams() internal pure returns (Rebalancer.Params memory) {
        return Rebalancer.Params({
            noticeSec: 172_800,
            modeChangeDelaySec: 172_800,
            driftBps: 5000,
            driftMinBps: 1000,
            driftMaxBps: 20_000,
            intervalSec: 2_592_000,
            dailyCapBps: 500,
            lossBudgetBps: 100,
            maxDurationSec: 1_209_600,
            premiumBps: 50,
            floorBps: 200,
            auctionSec: 2700,
            lotCapBps: 100
        });
    }

    function _assets5() internal view returns (address[] memory a, uint16[] memory w) {
        a = new address[](5);
        w = new uint16[](5);
        (a[0], a[1], a[2], a[3], a[4]) = (address(wavax), address(btcb), address(wethe), address(six), address(joe));
        for (uint256 i; i < 5; ++i) {
            w[i] = 2000;
        }
    }

    function _createMode(address who, string memory ticker, uint8 mode, uint32 drift, uint256 usdcIn)
        internal
        returns (IndexVault)
    {
        (address[] memory a, uint16[] memory w) = _assets5();
        IndexFactory.CreateParams memory p = _params(ticker, a, w, usdcIn, true);
        p.mode = mode;
        p.driftBps = drift;
        _fund(who, usdcIn + CREATION_FEE);
        vm.prank(who);
        (address idx,) = factory.createAndBuy(p);
        return IndexVault(idx);
    }

    /// @dev Refresh every price (keeps the pushed value) so time warps do not make them stale.
    function _refresh5() internal {
        _refreshAll();
        (uint256 p,) = oracle.latest(address(joe));
        _push(address(joe), p);
    }

    function _fillAll(IndexVault v, uint256 elapsed) internal returns (uint256 pay) {
        _warp(elapsed);
        Rebalancer.Auction memory au = rebalancer.auction(address(v));
        address aj = v.assets()[au.buyIdx];
        uint256 amount = au.lot - au.filled;
        vm.prank(admin);
        TestERC20(aj).mint(filler, type(uint128).max);
        vm.startPrank(filler);
        IERC20(aj).approve(address(rebalancer), type(uint256).max);
        pay = rebalancer.fill(address(v), amount, type(uint256).max);
        vm.stopPrank();
    }
}
