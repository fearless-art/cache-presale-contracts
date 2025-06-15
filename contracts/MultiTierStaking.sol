// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20, IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title MultiTierStaking
 * @notice A multi-tier staking contract that rewards users based on stake amount and lock duration
 * @dev This contract implements staking mechanisms with:
 *      - Tier-based bonuses (Silver, Gold, Diamond) based on stake amounts
 *      - Time-based multipliers with linear and quadratic scaling
 *      - Configurable reward periods with per-second distribution
 *      - Emergency functions for both users and admin
 */
contract MultiTierStaking is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
    // STRUCTS
    // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Represents a single stake made by a user
     * @param amount The amount of tokens staked
     * @param shares The calculated shares based on amount and multipliers
     * @param depositTime Timestamp when the stake was created
     * @param lockDuration Duration in seconds for which the stake is locked
     * @param rewardDebt Used for reward calculation to prevent double claiming
     */
    struct Stake {
        uint256 amount;
        uint256 shares;
        uint256 depositTime;
        uint256 lockDuration;
        uint256 rewardDebt;
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
    // STATE VARIABLES
    // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

    /// @notice The token that users stake to earn rewards
    IERC20 public immutable depositToken;

    /// @notice The token distributed as rewards to stakers
    IERC20 public immutable rewardToken;

    /// @notice Minimum stake amount required for Silver tier bonuses
    uint256 public immutable THRESHOLD_TOKEN_REQUIREMENT_SILVER;

    /// @notice Minimum stake amount required for Gold tier bonuses
    uint256 public immutable THRESHOLD_TOKEN_REQUIREMENT_GOLD;

    /// @notice Minimum stake amount required for Diamond tier bonuses
    uint256 public immutable THRESHOLD_TOKEN_REQUIREMENT_DIAMOND;

    /// @notice Bonus percentage for Silver tier (in basis points, e.g., 50000 = 5%)
    uint256 public immutable THRESHOLD_BONUS_PERCENTAGE_SILVER;

    /// @notice Bonus percentage for Gold tier (in basis points, e.g., 100000 = 10%)
    uint256 public immutable THRESHOLD_BONUS_PERCENTAGE_GOLD;

    /// @notice Bonus percentage for Diamond tier (in basis points, e.g., 200000 = 20%)
    uint256 public immutable THRESHOLD_BONUS_PERCENTAGE_DIAMOND;

    /// @notice Linear scaling constant for time-based bonuses
    uint256 public immutable LINEAR_SCALE_CONSTANT;

    /// @notice Quadratic scaling constant for time-based bonuses
    uint256 public immutable QUADRATIC_SCALE_CONSTANT;

    /// @notice Base multiplier used in reward calculations (1,000,000)
    uint256 public constant BASE_MULTIPLIER = 1_000_000;

    /// @notice Maximum multiplier numerator to cap bonus effects
    uint256 public immutable MAX_MULTIPLIER_NUMERATOR;

    /// @notice Total amount of reward tokens available for distribution
    uint256 public totalRewards;

    /// @notice Timestamp when reward distribution begins
    uint256 public rewardStartTime;

    /// @notice Timestamp when reward distribution ends
    uint256 public rewardEndTime;

    /// @notice Last timestamp when reward calculations were updated
    uint256 public lastUpdateTime;

    /// @notice Accumulated rewards per share (scaled by 1e18)
    uint256 public accRewardPerShare;

    /// @notice Total shares across all stakes (used for proportional reward distribution)
    uint256 public totalShares;

    /// @notice Maximum number of stakes a single user can have
    uint256 public constant MAX_STAKES_PER_USER = 20;

    /// @notice Number of seconds in a day (24 * 60 * 60)
    uint256 public constant DAY = 1 days;

    /// @notice Whether the contract has been funded with rewards
    bool public isFunded;

    /// @notice Mapping from user address to their array of stakes
    mapping(address => Stake[]) public userStakes;

    // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Emitted when a user deposits tokens to create a stake
     * @param user Address of the user making the deposit
     * @param amount Amount of tokens deposited
     * @param lockDays Number of days the stake will be locked
     */
    event Deposit(address indexed user, uint amount, uint lockDays);

    /**
     * @notice Emitted when a user withdraws a stake after lock period
     * @param user Address of the user withdrawing
     * @param amount Amount of tokens withdrawn
     * @param stakeId Index of the stake being withdrawn
     */
    event Withdraw(address indexed user, uint amount, uint stakeId);

    /**
     * @notice Emitted when a user emergency withdraws all stakes
     * @param user Address of the user performing emergency withdrawal
     * @param amount Total amount of tokens withdrawn
     */
    event EmergencyWithdrawAll(address indexed user, uint amount);

    /**
     * @notice Emitted when a user claims their pending rewards
     * @param user Address of the user claiming rewards
     * @param amount Amount of reward tokens claimed
     */
    event Claim(address indexed user, uint amount);

    /**
     * @notice Emitted when the owner adds funding to the reward pool
     * @param amount Amount of reward tokens added
     * @param newTotalRewards New total reward amount after addition
     */
    event FundsAdded(uint amount, uint newTotalRewards);

    /**
     * @notice Emitted when the owner removes funding from the reward pool
     * @param amount Amount of reward tokens removed
     * @param newTotalRewards New total reward amount after removal
     */
    event FundsRemoved(uint amount, uint newTotalRewards);

    /**
     * @notice Emitted when the reward period is configured
     * @param startTime Timestamp when rewards begin
     * @param endTime Timestamp when rewards end
     */
    event RewardPeriodSet(uint startTime, uint endTime);

    /**
     * @notice Emitted when remaining dust is withdrawn after reward period
     * @param user Address receiving the dust (owner)
     * @param amount Amount of dust withdrawn
     */
    event DustWithdrawn(address indexed user, uint amount);

    /**
     * @notice Emitted when the owner emergency stops the reward period
     * @param previousEndTime Original end time of rewards
     * @param newEndTime New end time (current timestamp)
     */
    event EmergencyStop(uint previousEndTime, uint newEndTime);

    // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
    // MODIFIERS
    // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Ensures the contract has been funded with rewards
     * @dev Reverts if totalRewards is 0
     */
    modifier onlyFunded() {
        require(totalRewards > 0, "No rewards available");
        _;
    }

    /**
     * @notice Ensures rewards have not started yet
     * @dev Used for configuration functions that should only work before rewards begin
     */
    modifier onlyBeforeRewardsStart() {
        require(
            rewardStartTime == 0 || block.timestamp < rewardStartTime,
            "Rewards already started"
        );
        _;
    }

    /**
     * @notice Ensures rewards have started
     * @dev Used for staking functions that require active reward period
     */
    modifier onlyAfterRewardsStart() {
        require(block.timestamp >= rewardStartTime, "Rewards not started");
        _;
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Initializes the MultiTierStaking contract
     * @param _depositToken Address of the token users will stake
     * @param _rewardToken Address of the token distributed as rewards
     * @param _silverThreshold Minimum amount for Silver tier bonuses
     * @param _goldThreshold Minimum amount for Gold tier bonuses
     * @param _diamondThreshold Minimum amount for Diamond tier bonuses
     * @param _silverBonus Bonus percentage for Silver tier (basis points)
     * @param _goldBonus Bonus percentage for Gold tier (basis points)
     * @param _diamondBonus Bonus percentage for Diamond tier (basis points)
     * @param _linearScaleConstant Linear scaling factor for time bonuses
     * @param _quadraticScaleConstant Quadratic scaling factor for time bonuses
     * @param _maxMultiplierNumerator Maximum total multiplier to cap bonuses
     * @dev Thresholds must be in ascending order: silver < gold < diamond
     */
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

    /**
     * @notice Deposits tokens to create a new stake with specified lock duration
     * @param amount Amount of deposit tokens to stake
     * @param lockDays Number of days to lock the stake
     * @dev Calculates multipliers based on amount (tier bonuses) and lock duration (time bonuses)
     * @dev Claims any existing pending rewards before creating new stake
     * @dev Reverts if user has reached MAX_STAKES_PER_USER limit
     * @dev Reverts if lock duration would extend beyond reward period end
     */
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

    /**
     * @notice Withdraws a specific stake after its lock period has expired
     * @param stakeId Index of the stake to withdraw from user's stakes array
     * @dev Claims all pending rewards before withdrawal
     * @dev Removes stake from array by swapping with last element and popping
     * @dev Reverts if stake is still within lock period
     */
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

    /**
     * @notice Claims all pending rewards for the caller
     * @dev Updates reward calculations and transfers pending rewards
     * @dev Only claims rewards for stakes that have passed their lock period
     */
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

    /**
     * @notice Emergency function to withdraw all stakes immediately (forfeits rewards)
     * @dev Does not require lock periods to be expired
     * @dev User forfeits all accumulated rewards
     * @dev Removes all user stakes and returns original deposit amounts
     */
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

    /**
     * @notice Returns all stakes for a specific user
     * @param user Address of the user to query
     * @return Array of Stake structs belonging to the user
     */
    function getUserStakes(
        address user
    ) external view returns (Stake[] memory) {
        return userStakes[user];
    }

    /**
     * @notice Calculates pending rewards for a user across all their unlocked stakes
     * @param user Address of the user to calculate rewards for
     * @return total Total pending rewards available for claiming
     * @dev Only includes rewards from stakes that have passed their lock period
     * @dev Simulates reward accumulation up to current timestamp
     */
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

    /**
     * @notice Calculates the reward distribution rate per second
     * @return Rate of reward token distribution per second
     * @dev Returns 0 if reward period hasn't been configured properly
     */
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

    /**
     * @notice Claims all pending rewards for a user and updates their reward debt
     * @param user Address of the user to claim rewards for
     * @return totalClaimed Total amount of rewards claimed
     * @dev Internal function used by claim() and other functions that need to settle rewards
     * @dev Only processes stakes that have passed their lock period
     */
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

    /**
     * @notice Updates the accumulated reward per share based on time elapsed
     * @dev Calculates rewards accrued since last update and distributes proportionally
     * @dev Does nothing if no time has passed, no shares exist, or contract is unfunded
     * @dev Caps reward calculation at rewardEndTime
     */
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

    /**
     * @notice Calculates the total multiplier numerator for a stake
     * @param amount Amount of tokens being staked
     * @param lockDays Number of days the stake will be locked
     * @return Combined multiplier numerator from tier and time bonuses
     * @dev Combines threshold-based bonuses (Silver/Gold/Diamond tiers) with time-based bonuses
     * @dev Time bonuses use both linear and quadratic scaling
     * @dev Result is capped at MAX_MULTIPLIER_NUMERATOR
     */
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

    /**
     * @notice Pauses the contract, preventing deposits, withdrawals, and claims
     * @dev Only callable by owner
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpauses the contract, restoring normal functionality
     * @dev Only callable by owner
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Adds reward tokens to the contract for distribution
     * @param amount Amount of reward tokens to add
     * @dev Only callable by owner before rewards start
     * @dev Transfers tokens from owner to contract
     * @dev Sets isFunded to true
     */
    function addFunding(
        uint256 amount
    ) external onlyOwner onlyBeforeRewardsStart {
        require(amount > 0, "Amount must be > 0");

        totalRewards += amount;
        rewardToken.safeTransferFrom(msg.sender, address(this), amount);
        isFunded = true;

        emit FundsAdded(amount, totalRewards);
    }

    /**
     * @notice Removes reward tokens from the contract
     * @param amount Amount of reward tokens to remove
     * @dev Only callable by owner before rewards start
     * @dev Sets isFunded to false if all rewards are removed
     */
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

    /**
     * @notice Configures the reward distribution period
     * @param _durationDays Duration of reward period in days
     * @param _rewardStartTime Timestamp when rewards should begin
     * @dev Only callable by owner before rewards start
     * @dev Start time must be in the future
     */
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

    /**
     * @notice Withdraws any remaining reward tokens after the reward period has ended
     * @dev Only callable 30 days after reward period ends
     * @dev Helps clean up any dust or unclaimed rewards
     */
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

    /**
     * @notice Emergency function to immediately end the reward period
     * @dev Only callable by owner during an active reward period
     * @dev Sets rewardEndTime to current timestamp, stopping further reward accumulation
     * @dev Updates reward calculations to ensure accuracy up to stop time
     */
    function emergencyStop() external onlyOwner {
        require(rewardEndTime > 0, "No reward period set");
        require(block.timestamp < rewardEndTime, "Reward period already ended");

        uint256 previousEndTime = rewardEndTime;
        rewardEndTime = block.timestamp;

        _update();

        emit EmergencyStop(previousEndTime, rewardEndTime);
    }
}
