// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {AssetRegistry} from "../src/core/AssetRegistry.sol";
import {IndexFactory} from "../src/core/IndexFactory.sol";
import {IndexLens} from "../src/core/IndexLens.sol";
import {IndexVault} from "../src/core/IndexVault.sol";
import {PriceOracle} from "../src/oracle/PriceOracle.sol";
import {Rebalancer} from "../src/rebalance/Rebalancer.sol";
import {TestERC20} from "../src/test-tokens/TestERC20.sol";
import {StockVenue} from "../src/venues/StockVenue.sol";

/// @title Demo
/// @notice End-to-end run on a deployment (P4 gate): an index with 2 stocks + 2 tokens goes through
///         create → buy → sell → redeem → price shock → Auto plan → auctions → fills.
///         DEMO_STAGE=1: create, trade, shock, trigger. Advance time past the notice, then
///         DEMO_STAGE=2: start the plan and fill auctions until done or the daily cap.
///         Env: NETWORK, DEPLOYER_PRIVATE_KEY (creator, pusher, filler), DEMO_USER_KEY (second wallet).
contract Demo is Script {
    using stdJson for string;

    string internal constant TICKER = "DEMO";
    string internal dep;
    uint256 internal pk;
    uint256 internal userPk;
    address internal deployer;
    address internal user;

    IERC20 internal usdc;
    PriceOracle internal oracle;
    AssetRegistry internal registry;
    StockVenue internal stockVenue;
    IndexFactory internal factory;
    Rebalancer internal rebalancer;
    IndexLens internal lens;

    function run() external {
        string memory network = vm.envOr("NETWORK", string("anvil"));
        dep = vm.readFile(string.concat(vm.projectRoot(), "/deployments/", network, ".json"));
        pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        userPk = vm.envUint("DEMO_USER_KEY");
        deployer = vm.addr(pk);
        user = vm.addr(userPk);
        usdc = IERC20(dep.readAddress(".contracts.usdc"));
        oracle = PriceOracle(dep.readAddress(".contracts.oracle"));
        registry = AssetRegistry(dep.readAddress(".contracts.assetRegistry"));
        stockVenue = StockVenue(dep.readAddress(".contracts.stockVenue"));
        factory = IndexFactory(dep.readAddress(".contracts.factory"));
        rebalancer = Rebalancer(dep.readAddress(".contracts.rebalancer"));
        lens = IndexLens(dep.readAddress(".contracts.lens"));

        uint256 stage = vm.envOr("DEMO_STAGE", uint256(1));
        if (stage == 1) _stage1();
        else _stage2();
    }

    function _asset(string memory id) internal view returns (address) {
        return dep.readAddress(string.concat(".assets.", id));
    }

    function _refreshPrices() internal {
        address[] memory all = registry.assets();
        uint256[] memory prices = new uint256[](all.length);
        for (uint256 i; i < all.length; ++i) {
            (prices[i],) = oracle.latest(all[i]);
        }
        oracle.pushMany(all, prices);
    }

    // ================================================================ stage 1

    function _stage1() internal {
        address[] memory a = new address[](4);
        uint16[] memory w = new uint16[](4);
        (a[0], a[1], a[2], a[3]) = (_asset("nvda"), _asset("aapl"), _asset("btcb"), _asset("wavax"));
        (w[0], w[1], w[2], w[3]) = (2500, 2500, 2500, 2500);

        vm.startBroadcast(pk);
        _refreshPrices();
        TestERC20(address(usdc)).mint(deployer, 20_000e6);
        TestERC20(address(usdc)).mint(user, 5_000e6);
        usdc.approve(address(factory), type(uint256).max);
        (address idx, uint256 units) = factory.createAndBuy(
            IndexFactory.CreateParams({
                name: "Demo Stocks + Crypto",
                ticker: TICKER,
                description: "2 stocks + 2 tokens, Auto rebalancing at 20 % drift",
                assets: a,
                weightsBps: w,
                mode: 2,
                driftBps: 2000,
                isPublic: true,
                usdcIn: 10_000e6,
                minUnits: 0
            })
        );
        vm.stopBroadcast();
        IndexVault v = IndexVault(idx);
        uint256 level = lens.level(idx);
        console2.log("index", idx);
        console2.log("creator units", units);
        console2.log("level after first buy (1e18)", level);
        require(level > 99.9999e18 && level < 100.0001e18, "level must start at 100");

        vm.startBroadcast(userPk);
        usdc.approve(idx, type(uint256).max);
        uint256 bought = v.buy(1000e6, 0, user);
        uint256 out = v.sell(bought / 3, 0, user);
        uint256[] memory red = v.redeem(bought / 3, user, new address[](0));
        vm.stopBroadcast();
        console2.log("user bought units", bought);
        console2.log("user sold 1/3 for USDC", out);
        console2.log("user redeemed 1/3, pNVDA received", red[0]);
        require(out > 0 && red[0] > 0 && red[3] > 0, "sell / redeem");

        // scripted shock: NVDA +40 %
        (uint256 p,) = oracle.latest(a[0]);
        vm.startBroadcast(pk);
        oracle.push(a[0], p * 14 / 10);
        vm.stopBroadcast();
        uint256 drift = lens.maxDriftBps(idx);
        console2.log("max drift after shock (bps)", drift);
        require(drift >= 2000, "drift >= theta");
        vm.startBroadcast(pk);
        uint64 startAt = rebalancer.trigger(idx);
        vm.stopBroadcast();
        console2.log("plan scheduled, starts at", startAt);
    }

    // ================================================================ stage 2

    function _stage2() internal {
        address idx = factory.indexByTicker(keccak256(bytes(TICKER)));
        require(idx != address(0), "run stage 1 first");
        IndexVault v = IndexVault(idx);
        uint256 before = lens.maxDriftBps(idx);

        vm.startBroadcast(pk);
        _refreshPrices();
        rebalancer.startPlan(idx);
        vm.stopBroadcast();

        Rebalancer.Plan memory p = rebalancer.plan(idx);
        uint256 cap = p.valueAtStart * rebalancer.params().dailyCapBps / 10_000;
        uint256 lotCap = p.valueAtStart * rebalancer.params().lotCapBps / 10_000;
        uint256 fills;
        for (uint256 k; k < 20; ++k) {
            if (rebalancer.plan(idx).status != Rebalancer.Status.Active) break;
            if (rebalancer.tradedLast24h(idx) + lotCap > cap) break; // wait for the daily cap window
            vm.startBroadcast(pk);
            uint32 id = rebalancer.openAuction(idx);
            vm.stopBroadcast();
            if (id == 0) break;
            _fill(v, idx);
            ++fills;
        }
        uint256 afterDrift = lens.maxDriftBps(idx);
        p = rebalancer.plan(idx);
        console2.log("fills", fills);
        console2.log("plan status", uint256(p.status));
        console2.log("plan loss (USD 1e18, signed)", p.loss);
        console2.log("max drift before (bps)", before);
        console2.log("max drift after  (bps)", afterDrift);
        require(afterDrift < before, "drift reduced");
        require(p.loss <= int256(p.lossBudget), "loss budget");
    }

    function _fill(IndexVault v, address idx) internal {
        Rebalancer.Auction memory au = rebalancer.auction(idx);
        address aj = v.assets()[au.buyIdx];
        uint8 di = v.assetDecimals()[au.sellIdx];
        uint8 dj = v.assetDecimals()[au.buyIdx];
        uint256 pay = au.lot * 10 ** dj * rebalancer.currentPrice(idx) / (10 ** di * 1e18) + 1;
        vm.startBroadcast(pk);
        (AssetRegistry.Kind kind,,,) = _info(aj);
        if (kind == AssetRegistry.Kind.Stock) {
            (uint256 pj,) = oracle.latest(aj);
            uint256 usdcIn = pay * pj / 1e18 / 1e12 * 102 / 100 + 1e6;
            TestERC20(address(usdc)).mint(deployer, usdcIn);
            usdc.approve(address(stockVenue), usdcIn);
            stockVenue.swapExactIn(address(usdc), aj, usdcIn, 0, deployer);
        } else {
            TestERC20(aj).mint(deployer, pay);
        }
        IERC20(aj).approve(address(rebalancer), type(uint256).max);
        rebalancer.fill(idx, au.lot, type(uint256).max);
        vm.stopBroadcast();
        console2.log("filled auction", au.id, IERC20Metadata(aj).symbol());
    }

    function _info(address a) internal view returns (AssetRegistry.Kind, uint8, bool, address) {
        AssetRegistry.AssetInfo memory i = registry.info(a);
        return (i.kind, i.decimals, i.buysPaused, i.venue);
    }
}
