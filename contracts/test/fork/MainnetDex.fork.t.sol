// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Deploy} from "../../script/Deploy.s.sol";
import {ConfigReader} from "../../script/lib/ConfigReader.sol";
import {IndexFactory} from "../../src/core/IndexFactory.sol";
import {IndexVault} from "../../src/core/IndexVault.sol";
import {SwapRouter} from "../../src/router/SwapRouter.sol";
import {DexVenue} from "../../src/venues/DexVenue.sol";

/// @notice Mainnet readiness (spec §7, §14): DexVenue on an Avalanche C-Chain fork with the configured routes, and
///         the production deploy end to end. Runs only with AVALANCHE_FORK_RPC set (public RPCs are slow, so it is
///         kept out of the default suite):
///           AVALANCHE_FORK_RPC=https://… forge test --match-path "test/fork/*" -vv
contract MainnetDexForkTest is Test {
    string internal routes;
    bool internal on;
    IERC20 internal usdc;

    function setUp() public {
        string memory rpc = vm.envOr("AVALANCHE_FORK_RPC", string(""));
        on = bytes(rpc).length > 0;
        if (!on) return;
        vm.createSelectFork(rpc);
        routes = ConfigReader.read("config/dex-routes.avalanche.json");
        string memory assets = ConfigReader.read("config/assets.avalanche.json");
        usdc = IERC20(vm.parseJsonAddress(assets, ".assets[0].addr"));
    }

    function _route(uint256 i) internal view returns (string memory id, address token, DexVenue.Hop[] memory hops) {
        string memory k = string.concat(".routes[", vm.toString(i), "]");
        id = vm.parseJsonString(routes, string.concat(k, ".asset"));
        token = vm.parseJsonAddress(routes, string.concat(k, ".token"));
        address[] memory pools = vm.parseJsonAddressArray(routes, string.concat(k, ".pools"));
        uint256[] memory kinds = vm.parseJsonUintArray(routes, string.concat(k, ".kinds"));
        uint256[] memory fees = vm.parseJsonUintArray(routes, string.concat(k, ".fees"));
        hops = new DexVenue.Hop[](pools.length);
        for (uint256 j; j < pools.length; ++j) {
            hops[j] = DexVenue.Hop({pool: pools[j], kind: DexVenue.Kind(kinds[j]), feeBps: uint16(fees[j])});
        }
    }

    function _count() internal view returns (uint256 n) {
        while (vm.keyExistsJson(routes, string.concat(".routes[", vm.toString(n), "]"))) ++n;
    }

    /// Every configured route: the view quote equals what the swap pays, both ways, through the real pools.
    function test_everyRoute_quoteEqualsSwap() public {
        vm.skip(!on);
        DexVenue v = new DexVenue(address(this), address(usdc));
        uint256 n = _count();
        uint256 usdcIn = 20 * 10 ** IERC20Metadata(address(usdc)).decimals(); // $20 per route
        for (uint256 i; i < n; ++i) {
            (string memory id, address token, DexVenue.Hop[] memory hops) = _route(i);
            v.setRoute(token, hops);
            uint256 snap = vm.snapshotState();
            deal(address(usdc), address(this), usdcIn);
            usdc.approve(address(v), usdcIn);
            uint256 qBuy = v.quote(address(usdc), token, usdcIn);
            uint256 before = IERC20(token).balanceOf(address(this));
            uint256 got = v.swapExactIn(address(usdc), token, usdcIn, qBuy, address(this));
            assertEq(got, qBuy, string.concat(id, ": buy quote != swap"));
            assertEq(IERC20(token).balanceOf(address(this)) - before, got, string.concat(id, ": buy delivered"));
            // and back: half of it to USDC
            uint256 half = got / 2;
            IERC20(token).approve(address(v), half);
            uint256 qSell = v.quote(token, address(usdc), half);
            uint256 u0 = usdc.balanceOf(address(this));
            uint256 back = v.swapExactIn(token, address(usdc), half, qSell, address(this));
            assertEq(back, qSell, string.concat(id, ": sell quote != swap"));
            assertEq(usdc.balanceOf(address(this)) - u0, back, string.concat(id, ": sell delivered"));
            console2.log(id, "buy out", got);
            vm.revertToState(snap);
        }
    }

    /// The production deploy on a fork, then an index's whole life with real USDC through real pools.
    function test_productionDeploy_createBuySellRedeem() public {
        vm.skip(!on);
        uint256 pk = 0xA11CE;
        address me = vm.addr(pk);
        vm.setEnv("NETWORK", "avalanche");
        vm.setEnv("DEPLOY_WRITE", "false");
        vm.setEnv("DEPLOYER_PRIVATE_KEY", vm.toString(pk));
        Deploy d = new Deploy();
        d.run();
        (address usdcAddr,, address registry,, address venue, address factoryAddr,,, address routerAddr) = d.deployed();
        assertEq(usdcAddr, address(usdc), "real USDC");
        assertTrue(venue != address(0) && registry != address(0), "dex venue deployed");
        IndexFactory factory = IndexFactory(factoryAddr);

        (,, address wavax) = (0, 0, _token("wavax"));
        address btcb = _token("btcb");
        address joe = _token("joe");
        address[] memory assets = new address[](3);
        (assets[0], assets[1], assets[2]) = (wavax, btcb, joe);
        uint16[] memory w = new uint16[](3);
        (w[0], w[1], w[2]) = (5000, 3000, 2000);

        uint256 one = 1e6;
        deal(address(usdc), me, 1_000 * one);
        vm.startPrank(me);
        usdc.approve(address(factory), type(uint256).max);
        (address index, uint256 units) = factory.createAndBuy(
            IndexFactory.CreateParams({
                name: "Fork Majors",
                ticker: "FORK",
                description: "",
                assets: assets,
                weightsBps: w,
                mode: 1,
                driftBps: 0,
                isPublic: true,
                usdcIn: 200 * one,
                minUnits: 0
            })
        );
        assertGt(units, 0, "units minted");
        IndexVault vault = IndexVault(index);
        uint256[] memory bal = vault.balances();
        for (uint256 i; i < 3; ++i) assertGt(bal[i], 0, "every leg bought through the pools");

        // buy more, sell part, redeem the rest in kind
        usdc.approve(index, type(uint256).max);
        uint256 more = vault.buy(100 * one, 0, me);
        assertGt(more, 0, "buy");
        uint256 held = vault.balanceOf(me);
        uint256 u0 = usdc.balanceOf(me);
        vault.sell(held / 2, 0, me);
        assertGt(usdc.balanceOf(me), u0, "sell paid USDC");
        address[] memory none = new address[](0);
        uint256[] memory got = vault.redeem(vault.balanceOf(me), me, none);
        for (uint256 i; i < 3; ++i) assertGt(got[i], 0, "redeem in kind");

        // single-asset swap through the router: quote = swap
        SwapRouter router = SwapRouter(routerAddr);
        usdc.approve(address(router), 50 * one);
        (uint256 q,) = router.quote(address(usdc), btcb, 50 * one);
        uint256 out = router.swap(address(usdc), btcb, 50 * one, q, me);
        assertEq(out, q, "router quote = swap");
        vm.stopPrank();
    }

    function _token(string memory id) internal view returns (address t) {
        uint256 n = _count();
        for (uint256 i; i < n; ++i) {
            (string memory rid, address token,) = _route(i);
            if (keccak256(bytes(rid)) == keccak256(bytes(id))) return token;
        }
        revert(string.concat("no route for ", id));
    }
}
