// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {AssetRegistry} from "../src/core/AssetRegistry.sol";
import {IndexFactory} from "../src/core/IndexFactory.sol";
import {IndexLens} from "../src/core/IndexLens.sol";
import {IndexVault} from "../src/core/IndexVault.sol";
import {FeeSplitter} from "../src/fees/FeeSplitter.sol";
import {FixedPoint} from "../src/libraries/FixedPoint.sol";
import {PriceOracle} from "../src/oracle/PriceOracle.sol";
import {Rebalancer} from "../src/rebalance/Rebalancer.sol";
import {SwapRouter} from "../src/router/SwapRouter.sol";
import {TestERC20} from "../src/test-tokens/TestERC20.sol";
import {TestUSDC} from "../src/test-tokens/TestUSDC.sol";
import {DexVenue} from "../src/venues/DexVenue.sol";
import {StockVenue} from "../src/venues/StockVenue.sol";
import {TokenVenue} from "../src/venues/TokenVenue.sol";
import {ConfigReader, ContractAsset} from "./lib/ConfigReader.sol";

/// @title Deploy
/// @notice Deploys every contract from contracts/config/* and writes contracts/deployments/<network>.json
///         (spec §14.1). Env: DEPLOYER_PRIVATE_KEY, NETWORK (fuji | anvil | avalanche, default anvil), DEMO (shortened
///         notice and mode-change delay), optional KEEPER_PRICE_PUSHER_ADDRESS, KEEPER_AUTO_FUND_ADDRESS, KEEPER_FILLER_ADDRESS,
///         DEPLOY_WRITE (default true; false = no deployments file, for fork tests).
///         `avalanche` (production profile): the real USDC and tokens at their confirmed addresses, nothing minted,
///         tokens routed through DexVenue (config/dex-routes.avalanche.json); a token without a route is not listed,
///         and stocks are not listed until the mainnet stock venue is configured.
contract Deploy is Script {
    using ConfigReader for string;

    string internal network;
    string internal params;
    bool internal demo;
    address internal deployer;

    IERC20 internal usdc;
    TestUSDC internal testUsdc; // test networks only
    bool internal mainnet;
    DexVenue internal dexVenue; // mainnet only
    // DEX routes (mainnet), read once from config/dex-routes.avalanche.json
    string[] internal routeIds;
    address[] internal routeTokens;
    mapping(uint256 => DexVenue.Hop[]) internal routeHops;
    uint8 internal usdcDecimals;
    PriceOracle internal oracle;
    AssetRegistry internal registry;
    TokenVenue internal tokenVenue;
    StockVenue internal stockVenue;
    FeeSplitter internal splitter;
    IndexFactory internal factory;
    IndexVault internal vaultImpl;
    Rebalancer internal rebalancer;
    IndexLens internal lens;
    SwapRouter internal router;

    string[] internal assetIds;
    address[] internal assetAddrs;

    error UnconfirmedAddress(string id);
    error NoRoute(string id);
    error VenueNotBuilt(string id, string venue);

    function run() external {
        network = vm.envOr("NETWORK", string("anvil"));
        demo = vm.envOr("DEMO", false);
        params = ConfigReader.params();
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        deployer = vm.addr(pk);
        // Anvil and other test networks run the contest asset list (test tokens + pTokens).
        mainnet = _eq(network, "avalanche");
        string memory assetsNetwork = mainnet ? "avalanche" : "fuji";
        if (mainnet) _readRoutes(ConfigReader.read("config/dex-routes.avalanche.json"));
        ContractAsset[] memory assets = ConfigReader.assets(assetsNetwork);
        uint256 startBlock = block.number;

        vm.startBroadcast(pk);
        _deployCore(assets[0]);
        for (uint256 i = 1; i < assets.length; ++i) {
            _deployAsset(assets[i]);
        }
        if (!mainnet) _seed();
        _wireKeepers();
        vm.stopBroadcast();

        if (vm.envOr("DEPLOY_WRITE", true)) _write(startBlock);
    }

    // ---------------------------------------------------------------- core

    function _deployCore(ContractAsset memory quote) internal {
        require(_eq(quote.kind, "quote"), "first asset must be the quote");
        if (mainnet) {
            // the real USDC: never minted, never owned by us
            usdc = IERC20(_confirmed(quote));
            usdcDecimals = IERC20Metadata(address(usdc)).decimals();
        } else {
            if (!quote.mock) revert UnconfirmedAddress(quote.id);
            testUsdc = new TestUSDC(deployer);
            usdc = IERC20(address(testUsdc));
            usdcDecimals = testUsdc.decimals();
        }
        _record(quote.id, address(usdc));

        oracle = new PriceOracle(deployer);
        oracle.setPusher(deployer, true);
        oracle.setFixedPrice(address(usdc), quote.priceE18);

        registry = new AssetRegistry(deployer, address(usdc));
        if (mainnet) dexVenue = new DexVenue(deployer, address(usdc));
        else tokenVenue = new TokenVenue(deployer, address(oracle), address(usdc));
        stockVenue = new StockVenue(deployer, address(oracle), address(usdc), uint16(_u(".stockVenue.reserveRatioBps")));
        address treasury = _treasury();
        splitter = new FeeSplitter(
            deployer, address(usdc), treasury, uint16(_u(".fees.protocolBps")), uint16(_u(".fees.creatorBps"))
        );
        uint256 one = 10 ** usdcDecimals;
        factory = new IndexFactory(
            deployer,
            address(registry),
            treasury,
            IndexFactory.Limits({
                creationFee: _u(".factory.creationFeeUsdc") * one,
                minFirstBuy: _u(".factory.minFirstBuyUsdc") * one,
                minAssets: uint8(_u(".factory.minAssets")),
                maxAssets: uint8(_u(".factory.maxAssets")),
                minWeightBps: uint16(_u(".factory.minWeightBps"))
            })
        );
        vaultImpl = new IndexVault(
            address(factory),
            address(registry),
            address(oracle),
            address(splitter),
            uint16(_u(".vault.tradeFeeBps")),
            _u(".vault.deadUnitsWei"),
            _u(".vault.startLevelUsd")
        );
        factory.setVaultImplementation(address(vaultImpl));
        splitter.setRegistry(address(factory));
        rebalancer = new Rebalancer(address(factory), address(oracle), _rebalancerParams());
        factory.setRebalancer(address(rebalancer));
        lens = new IndexLens();
        router = new SwapRouter(deployer, address(registry), treasury, uint16(_u(".swapRouter.swapFeeBps")));
    }

    function _rebalancerParams() internal view returns (Rebalancer.Params memory p) {
        p = Rebalancer.Params({
            noticeSec: uint64(_u(".rebalancer.noticeSec")),
            modeChangeDelaySec: uint64(_u(".rebalancer.modeChangeDelaySec")),
            driftBps: uint32(_u(".rebalancer.driftBps")),
            driftMinBps: uint32(_u(".rebalancer.driftMinBps")),
            driftMaxBps: uint32(_u(".rebalancer.driftMaxBps")),
            intervalSec: uint64(_u(".rebalancer.intervalSec")),
            dailyCapBps: uint16(_u(".rebalancer.dailyCapBps")),
            lossBudgetBps: uint16(_u(".rebalancer.lossBudgetBps")),
            maxDurationSec: uint64(_u(".rebalancer.maxDurationSec")),
            premiumBps: uint16(_u(".rebalancer.premiumBps")),
            floorBps: uint16(_u(".rebalancer.floorBps")),
            auctionSec: uint64(_u(".rebalancer.auctionSec")),
            lotCapBps: uint16(_u(".rebalancer.lotCapBps"))
        });
        if (demo) {
            p.noticeSec = uint64(_u(".demoOverrides.noticeSec"));
            p.modeChangeDelaySec = uint64(_u(".demoOverrides.modeChangeDelaySec"));
        }
    }

    // ---------------------------------------------------------------- assets

    function _deployAsset(ContractAsset memory a) internal {
        address token;
        if (mainnet) {
            if (_eq(a.kind, "stock")) {
                console2.log("not listed (mainnet stock venue undecided):", a.id);
                return;
            }
            if (!_eq(a.venue, "dex-venue")) revert VenueNotBuilt(a.id, a.venue);
            token = _confirmed(a);
            if (!_setRoute(a.id, token)) {
                console2.log("not listed (no DEX route):", a.id);
                return;
            }
            registry.list(token, AssetRegistry.Kind.Token, address(dexVenue));
            oracle.configureAsset(token, uint64(a.maxAgeSec), a.bandMinE18, a.bandMaxE18);
            oracle.push(token, a.priceE18);
            _record(a.id, token);
            return;
        }
        if (_eq(a.kind, "stock")) {
            if (!_eq(a.venue, "stock-venue")) revert VenueNotBuilt(a.id, a.venue);
            token = stockVenue.listStock(a.pTokenName, a.pTokenSymbol, a.sizeCapUsd, a.oiCapUsd, uint16(a.spreadBps));
            registry.list(token, AssetRegistry.Kind.Stock, address(stockVenue));
        } else {
            if (!_eq(a.venue, "token-venue")) revert VenueNotBuilt(a.id, a.venue);
            if (!a.mock) revert UnconfirmedAddress(a.id);
            token = address(new TestERC20(a.name, a.symbol, uint8(a.decimals), deployer));
            registry.list(token, AssetRegistry.Kind.Token, address(tokenVenue));
            tokenVenue.setMarket(token, uint16(a.spreadBps));
            uint256 inventory = FixedPoint.amountFor(_u(".tokenVenue.seedInventoryUsd") * 1e18, a.priceE18, uint8(a.decimals));
            TestERC20(token).mint(address(tokenVenue), inventory);
        }
        oracle.configureAsset(token, uint64(a.maxAgeSec), a.bandMinE18, a.bandMaxE18);
        oracle.push(token, a.priceE18);
        _record(a.id, token);
    }

    function _seed() internal {
        uint256 one = 10 ** usdcDecimals;
        uint256 reserve = _u(".stockVenue.seedReserveUsdc") * one;
        testUsdc.mint(deployer, reserve);
        IERC20(address(usdc)).approve(address(stockVenue), reserve);
        stockVenue.fund(reserve);
        testUsdc.mint(address(tokenVenue), _u(".tokenVenue.seedUsdc") * one);
    }

    function _wireKeepers() internal {
        address pusher = vm.envOr("KEEPER_PRICE_PUSHER_ADDRESS", address(0));
        if (pusher != address(0)) oracle.setPusher(pusher, true);
        if (mainnet) return; // nothing to mint on mainnet: no auto-fund, the filler brings its own USDC
        address autoFund = vm.envOr("KEEPER_AUTO_FUND_ADDRESS", address(0));
        if (autoFund != address(0)) testUsdc.setMinter(autoFund, true);
        // demo filler buys what it pays with through the router, funded by test USDC
        address filler = vm.envOr("KEEPER_FILLER_ADDRESS", address(0));
        if (filler != address(0)) testUsdc.setMinter(filler, true);
    }

    // ---------------------------------------------------------------- output

    function _write(uint256 startBlock) internal {
        string memory c = "contracts";
        vm.serializeAddress(c, "usdc", address(usdc));
        vm.serializeAddress(c, "oracle", address(oracle));
        vm.serializeAddress(c, "assetRegistry", address(registry));
        if (mainnet) vm.serializeAddress(c, "dexVenue", address(dexVenue));
        else vm.serializeAddress(c, "tokenVenue", address(tokenVenue));
        vm.serializeAddress(c, "stockVenue", address(stockVenue));
        vm.serializeAddress(c, "feeSplitter", address(splitter));
        vm.serializeAddress(c, "factory", address(factory));
        vm.serializeAddress(c, "vaultImplementation", address(vaultImpl));
        vm.serializeAddress(c, "rebalancer", address(rebalancer));
        vm.serializeAddress(c, "lens", address(lens));
        string memory contractsJson = vm.serializeAddress(c, "swapRouter", address(router));

        string memory a = "assets";
        string memory assetsJson;
        for (uint256 i; i < assetIds.length; ++i) {
            assetsJson = vm.serializeAddress(a, assetIds[i], assetAddrs[i]);
        }

        string memory root = "root";
        vm.serializeString(root, "network", network);
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeAddress(root, "deployer", deployer);
        vm.serializeUint(root, "startBlock", startBlock);
        vm.serializeBool(root, "demo", demo);
        vm.serializeString(root, "contracts", contractsJson);
        string memory out = vm.serializeString(root, "assets", assetsJson);
        string memory path = string.concat(vm.projectRoot(), "/deployments/", network, ".json");
        vm.writeJson(out, path);
        console2.log("deployments written:", path);
    }

    // ---------------------------------------------------------------- helpers

    /// @dev A confirmed mainnet address from the generated asset list ("TODO" = unconfirmed: never deployed against).
    function _confirmed(ContractAsset memory a) internal pure returns (address) {
        if (_eq(a.addr, "TODO") || _eq(a.addr, "deploy")) revert UnconfirmedAddress(a.id);
        return vm.parseAddress(a.addr);
    }

    function _readRoutes(string memory json) internal {
        for (uint256 i;; ++i) {
            string memory k = string.concat(".routes[", vm.toString(i), "]");
            if (!vm.keyExistsJson(json, k)) break;
            routeIds.push(vm.parseJsonString(json, string.concat(k, ".asset")));
            routeTokens.push(vm.parseJsonAddress(json, string.concat(k, ".token")));
            address[] memory pools = vm.parseJsonAddressArray(json, string.concat(k, ".pools"));
            uint256[] memory kinds = vm.parseJsonUintArray(json, string.concat(k, ".kinds"));
            uint256[] memory fees = vm.parseJsonUintArray(json, string.concat(k, ".fees"));
            for (uint256 j; j < pools.length; ++j) {
                routeHops[i].push(DexVenue.Hop({pool: pools[j], kind: DexVenue.Kind(kinds[j]), feeBps: uint16(fees[j])}));
            }
        }
    }

    /// @dev DexVenue route of `id` (config/dex-routes.avalanche.json); false when the asset has none.
    function _setRoute(string memory id, address token) internal returns (bool found) {
        for (uint256 i; i < routeIds.length && !found; ++i) {
            if (!_eq(routeIds[i], id)) continue;
            require(routeTokens[i] == token, "route token mismatch");
            dexVenue.setRoute(token, routeHops[i]);
            found = true;
        }
    }

    function _record(string memory id, address addr) internal {
        assetIds.push(id);
        assetAddrs.push(addr);
    }

    function _treasury() internal view returns (address) {
        string memory t = vm.parseJsonString(params, ".treasury");
        return _eq(t, "deployer") ? deployer : vm.parseAddress(t);
    }

    function _u(string memory key) internal view returns (uint256) {
        return vm.parseJsonUint(params, key);
    }

    function _eq(string memory a, string memory b) internal pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }

    // ---------------------------------------------------------------- accessors for scripts / tests

    function deployed()
        external
        view
        returns (address, address, address, address, address, address, address, address, address)
    {
        return (
            address(usdc),
            address(oracle),
            address(registry),
            address(stockVenue),
            mainnet ? address(dexVenue) : address(tokenVenue),
            address(factory),
            address(rebalancer),
            address(lens),
            address(router)
        );
    }
}
