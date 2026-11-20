// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {AssetRegistry} from "../../src/core/AssetRegistry.sol";
import {IndexFactory} from "../../src/core/IndexFactory.sol";
import {IndexLens} from "../../src/core/IndexLens.sol";
import {IndexVault} from "../../src/core/IndexVault.sol";
import {FeeSplitter} from "../../src/fees/FeeSplitter.sol";
import {PriceOracle} from "../../src/oracle/PriceOracle.sol";
import {TestERC20} from "../../src/test-tokens/TestERC20.sol";
import {TestUSDC} from "../../src/test-tokens/TestUSDC.sol";
import {TokenVenue} from "../../src/venues/TokenVenue.sol";

/// @notice Core deployment with 4 assets on a TokenVenue: AVAX, BTC.b (8 dp), WETH.e, and a 6-dp token
///         to exercise decimals. Parameters mirror contracts/config/params.json.
abstract contract Fixture is Test {
    address internal admin = makeAddr("admin");
    address internal treasury = makeAddr("treasury");
    address internal pusher = makeAddr("pusher");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    TestUSDC internal usdc;
    TestERC20 internal wavax;
    TestERC20 internal btcb;
    TestERC20 internal wethe;
    TestERC20 internal six;
    PriceOracle internal oracle;
    AssetRegistry internal registry;
    TokenVenue internal venue;
    FeeSplitter internal splitter;
    IndexFactory internal factory;
    IndexVault internal vaultImpl;
    IndexLens internal lens;

    uint256 internal constant CREATION_FEE = 5e6;
    uint16 internal constant SPREAD = 30;

    function setUp() public virtual {
        vm.warp(1_750_000_000);
        vm.startPrank(admin);
        usdc = new TestUSDC(admin);
        wavax = new TestERC20("Wrapped AVAX", "WAVAX", 18, admin);
        btcb = new TestERC20("Bitcoin", "BTC.b", 8, admin);
        wethe = new TestERC20("Wrapped Ether", "WETH.e", 18, admin);
        six = new TestERC20("Six", "SIX", 6, admin);

        oracle = new PriceOracle(admin);
        oracle.setPusher(pusher, true);
        oracle.setFixedPrice(address(usdc), 1e18);
        _cfg(address(wavax), 6.51e18);
        _cfg(address(btcb), 74_357e18);
        _cfg(address(wethe), 2946e18);
        _cfg(address(six), 12.5e18);

        registry = new AssetRegistry(admin, address(usdc));
        venue = new TokenVenue(admin, address(oracle), address(usdc));
        TestERC20[4] memory toks = [wavax, btcb, wethe, six];
        for (uint256 i; i < 4; ++i) {
            registry.list(address(toks[i]), AssetRegistry.Kind.Token, address(venue));
            venue.setMarket(address(toks[i]), SPREAD);
            toks[i].mint(address(venue), 10 ** (toks[i].decimals() + 9));
        }
        usdc.mint(address(venue), 1e9 * 1e6);

        splitter = new FeeSplitter(admin, address(usdc), treasury, 30, 20);
        factory = new IndexFactory(
            admin,
            address(registry),
            treasury,
            IndexFactory.Limits({
                creationFee: CREATION_FEE,
                minFirstBuy: 100e6,
                minAssets: 2,
                maxAssets: 20,
                minWeightBps: 100
            })
        );
        vaultImpl = new IndexVault(address(factory), address(registry), address(oracle), address(splitter), 50, 0.01e18, 100);
        factory.setVaultImplementation(address(vaultImpl));
        splitter.setRegistry(address(factory));
        lens = new IndexLens();
        vm.stopPrank();
    }

    /// @dev Advance time. Uses vm.getBlockTimestamp() because via-IR may cache block.timestamp.
    function _warp(uint256 secs) internal {
        vm.warp(vm.getBlockTimestamp() + secs);
    }

    function _cfg(address a, uint256 price) internal {
        oracle.configureAsset(a, 3600, price / 5, price * 5);
        vm.stopPrank();
        vm.prank(pusher);
        oracle.push(a, price);
        vm.startPrank(admin);
    }

    function _push(address a, uint256 price) internal {
        vm.prank(pusher);
        oracle.push(a, price);
    }

    function _refreshAll() internal {
        address[4] memory a = [address(wavax), address(btcb), address(wethe), address(six)];
        for (uint256 i; i < 4; ++i) {
            (uint256 p,) = oracle.latest(a[i]);
            _push(a[i], p);
        }
    }

    function _fund(address who, uint256 amount) internal {
        vm.prank(admin);
        usdc.mint(who, amount);
        vm.prank(who);
        usdc.approve(address(factory), type(uint256).max);
    }

    function _assets3() internal view returns (address[] memory a, uint16[] memory w) {
        a = new address[](3);
        w = new uint16[](3);
        (a[0], a[1], a[2]) = (address(wavax), address(btcb), address(wethe));
        (w[0], w[1], w[2]) = (2000, 5000, 3000);
    }

    function _params(string memory ticker, address[] memory a, uint16[] memory w, uint256 usdcIn, bool isPublic)
        internal
        pure
        returns (IndexFactory.CreateParams memory)
    {
        return IndexFactory.CreateParams({
            name: "Test index",
            ticker: ticker,
            description: "",
            assets: a,
            weightsBps: w,
            mode: 0,
            driftBps: 0,
            isPublic: isPublic,
            usdcIn: usdcIn,
            minUnits: 0
        });
    }

    function _create(address who, string memory ticker, uint256 usdcIn, bool isPublic)
        internal
        returns (IndexVault vault, uint256 units)
    {
        (address[] memory a, uint16[] memory w) = _assets3();
        _fund(who, usdcIn + CREATION_FEE);
        vm.prank(who);
        (address idx, uint256 u) = factory.createAndBuy(_params(ticker, a, w, usdcIn, isPublic));
        return (IndexVault(idx), u);
    }

    function _buy(IndexVault vault, address who, uint256 usdcIn) internal returns (uint256 units) {
        vm.prank(admin);
        usdc.mint(who, usdcIn);
        vm.startPrank(who);
        usdc.approve(address(vault), usdcIn);
        units = vault.buy(usdcIn, 0, who);
        vm.stopPrank();
    }

    /// @dev Per-unit holdings of every asset, 1e18-scaled.
    function _perUnit(IndexVault vault) internal view returns (uint256[] memory r) {
        uint256[] memory b = vault.balances();
        uint256 s = vault.totalSupply();
        r = new uint256[](b.length);
        for (uint256 i; i < b.length; ++i) {
            r[i] = b[i] * 1e18 / s;
        }
    }
}
