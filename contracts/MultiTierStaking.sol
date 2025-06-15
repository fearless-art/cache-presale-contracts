// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20, IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract MultiTierStaking is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Stake {
        uint256 amount;
        uint256 shares;
        uint256 depositTime;
        uint256 lockDuration;
        uint256 rewardDebt;
    }

    IERC20 public immutable depositToken;
    IERC20 public immutable rewardToken;

    uint256 public immutable THRESHOLD_TOKEN_REQUIREMENT_SILVER;
    uint256 public immutable THRESHOLD_TOKEN_REQUIREMENT_GOLD;
    uint256 public immutable THRESHOLD_TOKEN_REQUIREMENT_DIAMOND;

    uint256 public immutable THRESHOLD_BONUS_PERCENTAGE_SILVER;
    uint256 public immutable THRESHOLD_BONUS_PERCENTAGE_GOLD;
    uint256 public immutable THRESHOLD_BONUS_PERCENTAGE_DIAMOND;

    uint256 public immutable LINEAR_SCALE_CONSTANT;
    uint256 public immutable QUADRATIC_SCALE_CONSTANT;

    uint256 public constant BASE_MULTIPLIER = 1_000_000;
    uint256 public immutable MAX_MULTIPLIER_NUMERATOR;

    uint256 public totalRewards;
    uint256 public rewardStartTime;
    uint256 public rewardEndTime;
    uint256 public lastUpdateTime;
    uint256 public accRewardPerShare;
    uint256 public totalShares;

    uint256 public constant MAX_STAKES_PER_USER = 20;

    uint256 public constant DAY = 1 days;
    bool public isFunded;

    mapping(address => Stake[]) public userStakes;

    event Deposit(address indexed user, uint amount, uint lockDays);
    event Withdraw(address indexed user, uint amount, uint stakeId);
    event EmergencyWithdrawAll(address indexed user, uint amount);
    event Claim(address indexed user, uint amount);
    event FundsAdded(uint amount, uint newTotalRewards);
    event FundsRemoved(uint amount, uint newTotalRewards);
    event RewardPeriodSet(uint startTime, uint endTime);
    event DustWithdrawn(address indexed user, uint amount);
    event EmergencyStop(uint previousEndTime, uint newEndTime);

    modifier onlyFunded() {
        require(totalRewards > 0, "No rewards available");
        _;
    }

    modifier onlyBeforeRewardsStart() {
        require(
            rewardStartTime == 0 || block.timestamp < rewardStartTime,
            "Rewards already started"
        );
        _;
    }

    modifier onlyAfterRewardsStart() {
        require(block.timestamp >= rewardStartTime, "Rewards not started");
        _;
    }

    constructor(
        address _depositToken,
        address _rewardToken,
        uint256 _silverThreshold,
        uint256 _goldThreshold,
        uint256 _diamondThreshold,
        uint256 _silverBonus,
        uint256 _goldBonus,
        uint256 _diamondBonus,
        uint256 _linearScaleConstant,
        uint256 _quadraticScaleConstant,
        uint256 _maxMultiplierNumerator
    ) Ownable(msg.sender) {
        require(_depositToken != address(0) && _rewardToken != address(0));
        require(
            _silverThreshold < _goldThreshold &&
                _goldThreshold < _diamondThreshold,
            "Invalid thresholds"
        );

        depositToken = IERC20(_depositToken);
        rewardToken = IERC20(_rewardToken);

        THRESHOLD_TOKEN_REQUIREMENT_SILVER = _silverThreshold;
        THRESHOLD_TOKEN_REQUIREMENT_GOLD = _goldThreshold;
        THRESHOLD_TOKEN_REQUIREMENT_DIAMOND = _diamondThreshold;

        THRESHOLD_BONUS_PERCENTAGE_SILVER = _silverBonus;
        THRESHOLD_BONUS_PERCENTAGE_GOLD = _goldBonus;
        THRESHOLD_BONUS_PERCENTAGE_DIAMOND = _diamondBonus;

        LINEAR_SCALE_CONSTANT = _linearScaleConstant;
        QUADRATIC_SCALE_CONSTANT = _quadraticScaleConstant;

        MAX_MULTIPLIER_NUMERATOR = _maxMultiplierNumerator;
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
    // PUBLIC FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

    function deposit(
        uint256 amount,
        uint256 lockDays
    ) external whenNotPaused nonReentrant onlyFunded onlyAfterRewardsStart {
        require(amount > 0, "Zero amount");
        require(
            userStakes[msg.sender].length < MAX_STAKES_PER_USER,
            "Max stakes reached"
        );

        uint256 lockDuration = lockDays * DAY;
        require(block.timestamp + lockDuration <= rewardEndTime, "Too long");

        _claimAll(msg.sender);
        depositToken.safeTransferFrom(msg.sender, address(this), amount);

        uint256 multiplierNumerator = _calculateMultiplierNumerator(
            amount,
            lockDays
        );
        uint256 shares = (amount * multiplierNumerator) /
            (BASE_MULTIPLIER * BASE_MULTIPLIER);

        require(shares > 0, "Amount too small. Resulted in 0 shares");
        _update();

        userStakes[msg.sender].push(
            Stake({
                amount: amount,
                shares: shares,
                depositTime: block.timestamp,
                lockDuration: lockDuration,
                rewardDebt: (shares * accRewardPerShare) / 1e18
            })
        );

        totalShares += shares;
        emit Deposit(msg.sender, amount, lockDays);
    }

    function withdraw(
        uint256 stakeId
    ) external whenNotPaused nonReentrant onlyFunded onlyAfterRewardsStart {
        Stake[] storage stakes = userStakes[msg.sender];
        require(stakeId < stakes.length, "Invalid ID");

        Stake memory s = stakes[stakeId];
        require(
            block.timestamp >= s.depositTime + s.lockDuration,
            "Still locked"
        );

        _claimAll(msg.sender);
        _update();

        totalShares -= s.shares;

        stakes[stakeId] = stakes[stakes.length - 1];
        stakes.pop();

        depositToken.safeTransfer(msg.sender, s.amount);
        emit Withdraw(msg.sender, s.amount, stakeId);
    }

    function claim()
        external
        whenNotPaused
        nonReentrant
        onlyFunded
        onlyAfterRewardsStart
    {
        uint256 claimed = _claimAll(msg.sender);
        if (claimed > 0) emit Claim(msg.sender, claimed);
    }

    function emergencyWithdrawAll()
        external
        nonReentrant
        onlyAfterRewardsStart
    {
        Stake[] storage stakes = userStakes[msg.sender];
        require(stakes.length > 0, "No stakes to withdraw");

        uint256 totalAmount = 0;
        uint256 totalSharesToRemove = 0;

        // Calculate total amount and shares to remove
        for (uint i = 0; i < stakes.length; i++) {
            totalAmount += stakes[i].amount;
            totalSharesToRemove += stakes[i].shares;
        }

        // Update global state
        _update();
        totalShares -= totalSharesToRemove;

        // Clear all user stakes
        delete userStakes[msg.sender];

        // Transfer all deposited tokens back to user (no rewards)
        depositToken.safeTransfer(msg.sender, totalAmount);

        emit EmergencyWithdrawAll(msg.sender, totalAmount);
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

    function getUserStakes(
        address user
    ) external view returns (Stake[] memory) {
        return userStakes[user];
    }

    function pendingRewards(
        address user
    ) external view returns (uint256 total) {
        Stake[] memory stakes = userStakes[user];
        uint256 _acc = accRewardPerShare;
        if (block.timestamp > lastUpdateTime && totalShares > 0) {
            uint256 to = block.timestamp > rewardEndTime
                ? rewardEndTime
                : block.timestamp;
            uint256 duration = to - lastUpdateTime;
            uint256 reward = duration * rewardPerSecond();
            _acc += (reward * 1e18) / totalShares;
        }
        for (uint i = 0; i < stakes.length; i++) {
            Stake memory s = stakes[i];
            if (block.timestamp < s.depositTime + s.lockDuration) continue;
            total += ((s.shares * _acc) / 1e18) - s.rewardDebt;
        }
    }

    function rewardPerSecond() public view returns (uint256) {
        if (rewardStartTime == 0 || rewardEndTime <= rewardStartTime) {
            return 0;
        }
        uint256 duration = rewardEndTime - rewardStartTime;
        return totalRewards / duration;
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
    // INTERNAL FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

    function _claimAll(address user) internal returns (uint256 totalClaimed) {
        _update();
        Stake[] storage stakes = userStakes[user];
        for (uint i = 0; i < stakes.length; i++) {
            Stake storage s = stakes[i];
            if (block.timestamp < s.depositTime + s.lockDuration) continue;
            uint256 pending = ((s.shares * accRewardPerShare) / 1e18) -
                s.rewardDebt;
            if (pending > 0) {
                s.rewardDebt = (s.shares * accRewardPerShare) / 1e18;
                rewardToken.safeTransfer(user, pending);
                totalClaimed += pending;
            }
        }
    }

    function _update() internal {
        if (
            block.timestamp == lastUpdateTime || totalShares == 0 || !isFunded // what if everybody removes their stakes before the end of the reward period?
        ) {
            lastUpdateTime = block.timestamp;
            return;
        }

        uint256 to = block.timestamp > rewardEndTime
            ? rewardEndTime
            : block.timestamp;
        uint256 duration = to - lastUpdateTime;
        uint256 rewards = duration * rewardPerSecond();
        accRewardPerShare += (rewards * 1e18) / totalShares;
        lastUpdateTime = to;
    }

    function _calculateMultiplierNumerator(
        uint256 amount,
        uint256 lockDays
    ) internal view returns (uint256) {
        // Calculate threshold-based bonus
        uint256 thresholdMultiplierNumerator = BASE_MULTIPLIER;

        if (amount >= THRESHOLD_TOKEN_REQUIREMENT_DIAMOND) {
            thresholdMultiplierNumerator += THRESHOLD_BONUS_PERCENTAGE_DIAMOND;
        } else if (amount >= THRESHOLD_TOKEN_REQUIREMENT_GOLD) {
            thresholdMultiplierNumerator += THRESHOLD_BONUS_PERCENTAGE_GOLD;
        } else if (amount >= THRESHOLD_TOKEN_REQUIREMENT_SILVER) {
            thresholdMultiplierNumerator += THRESHOLD_BONUS_PERCENTAGE_SILVER;
        }

        // Calculate time-based bonus
        uint256 timeMultiplierNumerator = BASE_MULTIPLIER +
            (LINEAR_SCALE_CONSTANT * lockDays) +
            (QUADRATIC_SCALE_CONSTANT * lockDays * lockDays);

        return
            timeMultiplierNumerator * thresholdMultiplierNumerator >
                MAX_MULTIPLIER_NUMERATOR
                ? MAX_MULTIPLIER_NUMERATOR
                : timeMultiplierNumerator * thresholdMultiplierNumerator;
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
    // ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function addFunding(
        uint256 amount
    ) external onlyOwner onlyBeforeRewardsStart {
        require(amount > 0, "Amount must be > 0");

        totalRewards += amount;
        rewardToken.safeTransferFrom(msg.sender, address(this), amount);
        isFunded = true;

        emit FundsAdded(amount, totalRewards);
    }

    function removeFunding(
        uint256 amount
    ) external onlyOwner onlyBeforeRewardsStart {
        require(amount > 0, "Amount must be > 0");
        require(amount <= totalRewards, "Insufficient funds");

        totalRewards -= amount;
        rewardToken.safeTransfer(msg.sender, amount);

        if (totalRewards == 0) {
            isFunded = false;
        }

        emit FundsRemoved(amount, totalRewards);
    }

    function setRewardPeriod(
        uint256 _durationDays,
        uint256 _rewardStartTime
    ) external onlyOwner onlyBeforeRewardsStart {
        require(_durationDays > 0, "Duration must be > 0");
        require(
            _rewardStartTime > block.timestamp,
            "Start time must be in future"
        );

        rewardStartTime = _rewardStartTime;
        rewardEndTime = rewardStartTime + (_durationDays * 1 days);
        lastUpdateTime = block.timestamp;

        emit RewardPeriodSet(rewardStartTime, rewardEndTime);
    }

    function withdrawDust() external onlyOwner {
        require(
            block.timestamp > rewardEndTime + 30 days,
            "Reward period + 30 days not ended"
        );
        require(rewardEndTime > 0, "No reward period set");

        uint256 remainingBalance = rewardToken.balanceOf(address(this));
        require(remainingBalance > 0, "No dust to withdraw");

        rewardToken.safeTransfer(msg.sender, remainingBalance);

        emit DustWithdrawn(msg.sender, remainingBalance);
    }

    function emergencyStop() external onlyOwner {
        require(rewardEndTime > 0, "No reward period set");
        require(block.timestamp < rewardEndTime, "Reward period already ended");

        uint256 previousEndTime = rewardEndTime;
        rewardEndTime = block.timestamp;

        _update();

        emit EmergencyStop(previousEndTime, rewardEndTime);
    }
}
