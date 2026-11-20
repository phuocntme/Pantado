// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {FixedPoint} from "../libraries/FixedPoint.sol";
import {IPriceOracle} from "../oracle/IPriceOracle.sol";
import {IndexVault} from "../core/IndexVault.sol";
import {IRebalancer} from "./IRebalancer.sol";

/// @title Rebalancer
/// @notice Rebalance modes, Manual versions, Auto triggers, plans and Dutch auctions with guards
///         (spec §5.7–5.8). Guards hold for every plan, including agent-managed ones:
///         notice before start · ≤ dailyCapBps of V per rolling 24 h · loss ≤ lossBudgetBps of V ·
///         max duration. Auction prices never enter buy, sell or redeem — they only move assets here.
contract Rebalancer is IRebalancer, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    enum Mode {
        Off,
        Manual,
        Auto
    }

    enum Status {
        None,
        Scheduled,
        Active,
        Completed,
        Stopped, // loss budget reached or lots keep failing
        Expired, // max duration reached; filled trades stay
        Cancelled // mode turned Off before or during the plan
    }

    struct Params {
        uint64 noticeSec;
        uint64 modeChangeDelaySec;
        uint32 driftBps; // default θ
        uint32 driftMinBps;
        uint32 driftMaxBps;
        uint64 intervalSec;
        uint16 dailyCapBps;
        uint16 lossBudgetBps;
        uint64 maxDurationSec;
        uint16 premiumBps;
        uint16 floorBps;
        uint64 auctionSec;
        uint16 lotCapBps;
    }

    struct IndexState {
        bool registered;
        Mode mode;
        Mode pendingMode;
        bool hasPending;
        uint64 pendingAt; // effective time of the pending change
        uint32 driftBps;
        uint32 pendingDriftBps;
        uint64 lastPlanAt;
        uint32 planCount;
        uint32 version;
        address creator;
    }

    struct Plan {
        uint32 id;
        Status status;
        bool manual;
        uint32 version;
        uint64 startAt;
        uint64 startedAt;
        uint64 endedAt;
        uint256 valueAtStart; // V at start, USD 1e18
        uint256 lossBudget; // USD 1e18
        int256 loss; // Σ fair value given − fair value received, USD 1e18
        uint256 traded; // Σ fair value given
        uint256 lotDivisor; // 1, 2, 4… after lots that mostly fail
        uint32 auctionCount;
        uint16[] weights;
        uint256[] sellRem; // USD 1e18 still to sell per asset
        uint256[] buyRem; // USD 1e18 still to buy per asset
    }

    struct Auction {
        uint32 id;
        uint8 sellIdx; // asset i the vault gives
        uint8 buyIdx; // asset j the vault receives
        uint64 startAt;
        uint64 endAt;
        uint256 lot; // units of i
        uint256 lotUsd; // USD 1e18 at open (≤ lotCapBps of V)
        uint256 filled; // units of i
        uint256 refPrice; // j per i, 1e18 (whole tokens)
        uint256 startPrice;
        uint256 floorPrice;
    }

    uint256 public constant MIN_LOT_BPS = 1; // lots under 0.01 % of V end the plan
    uint256 internal constant HOUR = 3600;
    uint256 internal constant WINDOW_BUCKETS = 25; // conservative rolling 24 h

    address public immutable factory;
    IPriceOracle public immutable oracle;
    Params internal _p;

    mapping(address index => IndexState) internal _state;
    mapping(address index => Plan) internal _plan;
    mapping(address index => Auction) internal _auction;
    mapping(address index => mapping(uint256 hourIdx => uint256 usd)) internal _tradedByHour;

    event IndexRegistered(address indexed index, address indexed creator, Mode mode, uint32 driftBps);
    event ModeRequested(address indexed index, Mode mode, uint32 driftBps, uint64 effectiveAt);
    event ModeChanged(address indexed index, Mode mode, uint32 driftBps);
    event VersionPublished(address indexed index, uint32 version, uint16[] weights, string reason, uint64 startAt);
    event PlanScheduled(address indexed index, uint32 planId, bool manual, uint64 startAt, uint256 maxDriftBps);
    event PlanStarted(
        address indexed index, uint32 planId, uint256 value, uint256 lossBudget, uint256[] sellUsd, uint256[] buyUsd
    );
    event PlanEnded(address indexed index, uint32 planId, Status status, int256 loss, uint256 traded);
    event AuctionOpened(
        address indexed index,
        uint32 planId,
        uint32 auctionId,
        address sellAsset,
        address buyAsset,
        uint256 lot,
        uint256 startPrice,
        uint256 floorPrice,
        uint64 endAt
    );
    event AuctionFilled(
        address indexed index,
        uint32 planId,
        uint32 auctionId,
        address indexed filler,
        uint256 amountOut,
        uint256 amountIn,
        uint256 price,
        int256 lossDelta
    );

    error OnlyFactory();
    error NotCreator();
    error NotRegistered(address index);
    error BadMode();
    error BadDrift(uint32 driftBps);
    error MustPassThroughOff();
    error WrongMode(Mode mode);
    error PlanInProgress();
    error NoPlan();
    error NotDue();
    error TooEarly(uint64 startAt);
    error BadWeights();
    error AuctionLive();
    error NoAuction();
    error AuctionOver();
    error Exceeds(uint256 amount, uint256 available);
    error Slippage(uint256 pay, uint256 maxPay);
    error DailyCapReached(uint256 traded, uint256 cap);
    error LossBudgetExceeded(int256 loss, uint256 budget);
    error PlanExpired();
    error ZeroAmount();

    constructor(address factory_, address oracle_, Params memory params_) {
        if (params_.driftMinBps > params_.driftBps || params_.driftBps > params_.driftMaxBps) revert BadDrift(params_.driftBps);
        factory = factory_;
        oracle = IPriceOracle(oracle_);
        _p = params_;
    }

    // ================================================================ registration + modes

    /// @inheritdoc IRebalancer
    function registerIndex(address index, address creator, uint8 mode, uint32 driftBps) external {
        if (msg.sender != factory) revert OnlyFactory();
        if (mode > uint8(Mode.Auto)) revert BadMode();
        uint32 d = _checkDrift(Mode(mode), driftBps);
        _state[index] = IndexState({
            registered: true,
            mode: Mode(mode),
            pendingMode: Mode.Off,
            hasPending: false,
            pendingAt: 0,
            driftBps: d,
            pendingDriftBps: 0,
            lastPlanAt: uint64(block.timestamp),
            planCount: 0,
            version: 1,
            creator: creator
        });
        emit IndexRegistered(index, creator, Mode(mode), d);
    }

    /// @notice Request a mode change; it takes effect after `modeChangeDelaySec`. Auto → Manual must pass
    ///         through Off. A new request replaces a pending one.
    function requestMode(address index, Mode mode, uint32 driftBps) external {
        IndexState storage s = _creatorState(index);
        _sync(index);
        if (s.mode == Mode.Auto && mode == Mode.Manual) revert MustPassThroughOff();
        uint32 d = _checkDrift(mode, driftBps);
        s.hasPending = true;
        s.pendingMode = mode;
        s.pendingDriftBps = d;
        s.pendingAt = uint64(block.timestamp + _p.modeChangeDelaySec);
        emit ModeRequested(index, mode, d, s.pendingAt);
    }

    /// @notice Apply a due mode change and end a plan the change cancels. Anyone may call.
    function sync(address index) external {
        if (!_state[index].registered) revert NotRegistered(index);
        _sync(index);
    }

    // ================================================================ Manual versions

    /// @notice Publish new target weights (same assets, each ≥ 1 %, sum 10 000) with a reason. Starts a plan
    ///         after the notice period. One plan at a time.
    function publishVersion(address index, uint16[] calldata weights, string calldata reason)
        external
        returns (uint32 version)
    {
        IndexState storage s = _creatorState(index);
        _sync(index);
        if (s.mode != Mode.Manual) revert WrongMode(s.mode);
        _requireNoPlan(index);
        uint256 n = IndexVault(index).assetCount();
        if (weights.length != n) revert BadWeights();
        uint256 sum;
        for (uint256 i; i < n; ++i) {
            if (weights[i] < 100) revert BadWeights();
            sum += weights[i];
        }
        if (sum != 10_000) revert BadWeights();
        version = ++s.version;
        uint64 startAt = _schedule(index, true, weights, 0);
        _plan[index].version = version;
        emit VersionPublished(index, version, weights, reason, startAt);
    }

    // ================================================================ Auto trigger

    /// @notice True when an Auto index is due: max relative drift ≥ θ or the interval has elapsed.
    function isDue(address index) public view returns (bool due, uint256 maxDrift) {
        IndexState storage s = _state[index];
        (Mode mode, uint32 drift) = _effectiveMode(s);
        if (mode != Mode.Auto) return (false, 0);
        Status st = _plan[index].status;
        if (st == Status.Scheduled || st == Status.Active) return (false, 0);
        maxDrift = _maxDriftBps(index);
        due = maxDrift >= drift || block.timestamp >= s.lastPlanAt + _p.intervalSec;
    }

    /// @notice Schedule an Auto plan once due. Anyone may call.
    function trigger(address index) external returns (uint64 startAt) {
        if (!_state[index].registered) revert NotRegistered(index);
        _sync(index);
        (bool due, uint256 maxDrift) = isDue(index);
        if (!due) revert NotDue();
        startAt = _schedule(index, false, IndexVault(index).targetWeights(), maxDrift);
    }

    // ================================================================ plan lifecycle

    /// @notice Start a scheduled plan after its notice. Requires fresh prices. Anyone may call.
    function startPlan(address index) external nonReentrant {
        _sync(index);
        Plan storage p = _plan[index];
        if (p.status != Status.Scheduled) revert NoPlan();
        if (block.timestamp < p.startAt) revert TooEarly(p.startAt);

        IndexVault vault = IndexVault(index);
        if (p.manual) vault.setTargetWeights(p.weights);

        address[] memory a = vault.assets();
        uint8[] memory d = vault.assetDecimals();
        uint256[] memory b = vault.balances();
        uint256 n = a.length;
        uint256[] memory val = new uint256[](n);
        uint256 v;
        for (uint256 i; i < n; ++i) {
            val[i] = FixedPoint.valueOf(b[i], oracle.getPrice(a[i]), d[i]);
            v += val[i];
        }
        p.sellRem = new uint256[](n);
        p.buyRem = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            uint256 target = FixedPoint.mulBps(v, p.weights[i]);
            if (val[i] > target) p.sellRem[i] = val[i] - target;
            else p.buyRem[i] = target - val[i];
        }
        p.status = Status.Active;
        p.startedAt = uint64(block.timestamp);
        p.valueAtStart = v;
        p.lossBudget = FixedPoint.mulBps(v, _p.lossBudgetBps);
        p.lotDivisor = 1;
        _state[index].lastPlanAt = uint64(block.timestamp);
        emit PlanStarted(index, p.id, v, p.lossBudget, p.sellRem, p.buyRem);
    }

    /// @notice End a plan that is complete, expired or cancelled. Anyone may call.
    function finalize(address index) external {
        _sync(index);
        Plan storage p = _plan[index];
        if (p.status != Status.Active) revert NoPlan();
        if (block.timestamp > p.startedAt + _p.maxDurationSec) _end(index, Status.Expired);
        else if (_remaining(p) < _minLot(p)) _end(index, Status.Completed);
        else revert PlanInProgress();
    }

    // ================================================================ auctions

    /// @notice Open the next Dutch auction: the most overweight asset is sold for the most underweight one.
    ///         Lot = min(remaining, lotCap / divisor, daily cap left). Anyone may call (keepers).
    function openAuction(address index) external nonReentrant returns (uint32 auctionId) {
        _sync(index);
        Plan storage p = _plan[index];
        if (p.status != Status.Active) revert NoPlan();
        if (block.timestamp > p.startedAt + _p.maxDurationSec) {
            _end(index, Status.Expired);
            return 0;
        }
        Auction storage au = _auction[index];
        if (au.id != 0 && au.filled < au.lot && block.timestamp < au.endAt) revert AuctionLive();
        // a lot that mostly failed (< 50 % filled) is retried at half size
        if (au.id != 0 && au.filled * 2 < au.lot) p.lotDivisor *= 2;

        (uint256 i, uint256 j) = _pickPair(p);
        uint256 minLot = _minLot(p);
        uint256 lotCap = FixedPoint.mulBps(p.valueAtStart, _p.lotCapBps) / p.lotDivisor;
        if (p.sellRem[i] < minLot || p.buyRem[j] < minLot) {
            _end(index, Status.Completed);
            return 0;
        }
        if (lotCap < minLot) {
            _end(index, Status.Stopped);
            return 0;
        }
        uint256 capLeft = _dailyCapLeft(index, p);
        if (capLeft < minLot) revert DailyCapReached(_tradedWindow(index), _dailyCap(p));
        uint256 lotUsd = Math.min(Math.min(p.sellRem[i], p.buyRem[j]), Math.min(lotCap, capLeft));

        // worst case at the floor must fit the remaining loss budget
        int256 worst = p.loss + int256(FixedPoint.mulBpsUp(lotUsd, _p.floorBps));
        if (worst > int256(p.lossBudget)) {
            _end(index, Status.Stopped);
            return 0;
        }

        IndexVault vault = IndexVault(index);
        address[] memory a = vault.assets();
        uint8[] memory d = vault.assetDecimals();
        uint256 pi = oracle.getPrice(a[i]);
        uint256 pj = oracle.getPrice(a[j]);
        uint256 ref = Math.mulDiv(pi, 1e18, pj);
        auctionId = ++p.auctionCount;
        _auction[index] = Auction({
            id: auctionId,
            sellIdx: uint8(i),
            buyIdx: uint8(j),
            startAt: uint64(block.timestamp),
            endAt: uint64(block.timestamp + _p.auctionSec),
            lot: FixedPoint.amountFor(lotUsd, pi, d[i]),
            lotUsd: lotUsd,
            filled: 0,
            refPrice: ref,
            startPrice: FixedPoint.mulBps(ref, 10_000 + _p.premiumBps),
            floorPrice: FixedPoint.mulBps(ref, 10_000 - _p.floorBps)
        });
        Auction storage na = _auction[index];
        emit AuctionOpened(index, p.id, auctionId, a[i], a[j], na.lot, na.startPrice, na.floorPrice, na.endAt);
    }

    /// @notice Current auction price (j per i, 1e18): linear from start to floor over `auctionSec`, never
    ///         below the floor.
    function currentPrice(address index) public view returns (uint256) {
        Auction storage au = _auction[index];
        if (au.id == 0) revert NoAuction();
        uint256 elapsed = block.timestamp - au.startAt;
        if (elapsed >= _p.auctionSec) return au.floorPrice;
        return au.startPrice - Math.mulDiv(au.startPrice - au.floorPrice, elapsed, _p.auctionSec);
    }

    /// @notice Fill `amountOut` units of the sold asset, paying in the bought asset at the current price.
    ///         Partial fills allowed. Requires fresh prices; enforces daily cap and loss budget.
    function fill(address index, uint256 amountOut, uint256 maxPay) external nonReentrant returns (uint256 pay) {
        if (amountOut == 0) revert ZeroAmount();
        Plan storage p = _plan[index];
        Auction storage au = _auction[index];
        if (p.status != Status.Active || au.id == 0) revert NoAuction();
        if (block.timestamp > p.startedAt + _p.maxDurationSec) revert PlanExpired();
        if (block.timestamp >= au.endAt) revert AuctionOver();
        if (amountOut > au.lot - au.filled) revert Exceeds(amountOut, au.lot - au.filled);
        _requireModeActive(index);

        IndexVault vault = IndexVault(index);
        address ai = vault.assets()[au.sellIdx];
        address aj = vault.assets()[au.buyIdx];
        uint8 di = vault.assetDecimals()[au.sellIdx];
        uint8 dj = vault.assetDecimals()[au.buyIdx];
        uint256 price = currentPrice(index);
        pay = Math.mulDiv(amountOut * 10 ** dj, price, 10 ** di * 1e18, Math.Rounding.Ceil);
        if (pay > maxPay) revert Slippage(pay, maxPay);

        uint256 given = FixedPoint.valueOf(amountOut, oracle.getPrice(ai), di);
        uint256 received = FixedPoint.valueOf(pay, oracle.getPrice(aj), dj);
        int256 lossDelta = int256(given) - int256(received);
        p.loss += lossDelta;
        if (p.loss > int256(p.lossBudget)) revert LossBudgetExceeded(p.loss, p.lossBudget);

        uint256 cap = _dailyCap(p);
        uint256 window = _tradedWindow(index);
        if (window + given > cap) revert DailyCapReached(window + given, cap);
        _tradedByHour[index][block.timestamp / HOUR] += given;
        p.traded += given;

        au.filled += amountOut;
        p.sellRem[au.sellIdx] = _sub0(p.sellRem[au.sellIdx], given);
        p.buyRem[au.buyIdx] = _sub0(p.buyRem[au.buyIdx], received);

        IERC20(aj).safeTransferFrom(msg.sender, index, pay);
        vault.rebalanceTransfer(ai, amountOut, msg.sender);
        emit AuctionFilled(index, p.id, au.id, msg.sender, amountOut, pay, price, lossDelta);
    }

    // ================================================================ views

    function params() external view returns (Params memory) {
        return _p;
    }

    function state(address index) external view returns (IndexState memory s, Mode effectiveMode, uint32 effectiveDrift) {
        s = _state[index];
        (effectiveMode, effectiveDrift) = _effectiveMode(s);
    }

    function plan(address index) external view returns (Plan memory) {
        return _plan[index];
    }

    function auction(address index) external view returns (Auction memory) {
        return _auction[index];
    }

    function tradedLast24h(address index) external view returns (uint256) {
        return _tradedWindow(index);
    }

    function maxDriftBps(address index) external view returns (uint256) {
        return _maxDriftBps(index);
    }

    // ================================================================ internals

    function _creatorState(address index) internal view returns (IndexState storage s) {
        s = _state[index];
        if (!s.registered) revert NotRegistered(index);
        if (msg.sender != s.creator) revert NotCreator();
    }

    function _checkDrift(Mode mode, uint32 driftBps) internal view returns (uint32) {
        if (mode != Mode.Auto) return 0;
        if (driftBps == 0) return _p.driftBps;
        if (driftBps < _p.driftMinBps || driftBps > _p.driftMaxBps) revert BadDrift(driftBps);
        return driftBps;
    }

    function _effectiveMode(IndexState memory s) internal view returns (Mode, uint32) {
        if (s.hasPending && block.timestamp >= s.pendingAt) return (s.pendingMode, s.pendingDriftBps);
        return (s.mode, s.driftBps);
    }

    function _sync(address index) internal {
        IndexState storage s = _state[index];
        if (s.hasPending && block.timestamp >= s.pendingAt) {
            s.mode = s.pendingMode;
            s.driftBps = s.pendingDriftBps;
            s.hasPending = false;
            emit ModeChanged(index, s.mode, s.driftBps);
        }
        Plan storage p = _plan[index];
        if (s.mode == Mode.Off && (p.status == Status.Scheduled || p.status == Status.Active)) {
            _end(index, Status.Cancelled);
        }
    }

    function _requireModeActive(address index) internal view {
        (Mode m,) = _effectiveMode(_state[index]);
        if (m == Mode.Off) revert WrongMode(m);
    }

    function _requireNoPlan(address index) internal view {
        Status st = _plan[index].status;
        if (st == Status.Scheduled || st == Status.Active) revert PlanInProgress();
    }

    function _schedule(address index, bool manual, uint16[] memory weights, uint256 maxDrift)
        internal
        returns (uint64 startAt)
    {
        _requireNoPlan(index);
        IndexState storage s = _state[index];
        startAt = uint64(block.timestamp + _p.noticeSec);
        uint32 id = ++s.planCount;
        delete _auction[index];
        Plan storage p = _plan[index];
        p.id = id;
        p.status = Status.Scheduled;
        p.manual = manual;
        p.version = s.version;
        p.startAt = startAt;
        p.startedAt = 0;
        p.endedAt = 0;
        p.valueAtStart = 0;
        p.lossBudget = 0;
        p.loss = 0;
        p.traded = 0;
        p.lotDivisor = 1;
        p.auctionCount = 0;
        p.weights = weights;
        delete p.sellRem;
        delete p.buyRem;
        s.lastPlanAt = uint64(block.timestamp);
        emit PlanScheduled(index, id, manual, startAt, maxDrift);
    }

    function _end(address index, Status status) internal {
        Plan storage p = _plan[index];
        p.status = status;
        p.endedAt = uint64(block.timestamp);
        emit PlanEnded(index, p.id, status, p.loss, p.traded);
    }

    function _pickPair(Plan storage p) internal view returns (uint256 i, uint256 j) {
        uint256 bestS;
        uint256 bestB;
        for (uint256 k; k < p.sellRem.length; ++k) {
            if (p.sellRem[k] > bestS) (bestS, i) = (p.sellRem[k], k);
            if (p.buyRem[k] > bestB) (bestB, j) = (p.buyRem[k], k);
        }
    }

    function _remaining(Plan storage p) internal view returns (uint256 r) {
        (uint256 i, uint256 j) = _pickPair(p);
        if (p.sellRem.length == 0) return 0;
        r = Math.min(p.sellRem[i], p.buyRem[j]);
    }

    function _minLot(Plan storage p) internal view returns (uint256) {
        return FixedPoint.mulBps(p.valueAtStart, MIN_LOT_BPS);
    }

    function _dailyCap(Plan storage p) internal view returns (uint256) {
        return FixedPoint.mulBps(p.valueAtStart, _p.dailyCapBps);
    }

    /// @dev Traded in the current hour and the previous 24 — any 24 h window ending now is inside it.
    function _tradedWindow(address index) internal view returns (uint256 sum) {
        uint256 h = block.timestamp / HOUR;
        for (uint256 k; k < WINDOW_BUCKETS && k <= h; ++k) {
            sum += _tradedByHour[index][h - k];
        }
    }

    function _dailyCapLeft(address index, Plan storage p) internal view returns (uint256) {
        uint256 cap = _dailyCap(p);
        uint256 used = _tradedWindow(index);
        return used >= cap ? 0 : cap - used;
    }

    function _maxDriftBps(address index) internal view returns (uint256 maxDrift) {
        IndexVault vault = IndexVault(index);
        address[] memory a = vault.assets();
        uint8[] memory d = vault.assetDecimals();
        uint256[] memory b = vault.balances();
        uint16[] memory w = vault.targetWeights();
        uint256 n = a.length;
        uint256[] memory val = new uint256[](n);
        uint256 v;
        for (uint256 i; i < n; ++i) {
            val[i] = FixedPoint.valueOf(b[i], oracle.getPrice(a[i]), d[i]);
            v += val[i];
        }
        if (v == 0) return 0;
        for (uint256 i; i < n; ++i) {
            uint256 x = val[i] * 10_000;
            uint256 y = uint256(w[i]) * v;
            uint256 diff = x > y ? x - y : y - x;
            uint256 dr = Math.mulDiv(diff, 10_000, y);
            if (dr > maxDrift) maxDrift = dr;
        }
    }

    function _sub0(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a - b : 0;
    }
}
