import { expect } from "chai";
import hre from "hardhat";
import { type PublicClient, type WalletClient, parseEther } from "viem";

describe("MultiTierStaking", () => {
    let owner: WalletClient;
    let user: WalletClient;
    let user2: WalletClient;
    let user3: WalletClient;
    let publicClient: PublicClient;

    const fundRewards = parseEther("1000");
    const fundDurationDays = 30n;

    async function deployContracts() {
        [owner, user, user2, user3] = await hre.viem.getWalletClients();
        publicClient = await hre.viem.getPublicClient();

        // Deploy mock tokens
        const depositToken = await hre.viem.deployContract("ERC20Mock", [
            "Deposit Token",
            "DPT",
        ]);
        const rewardToken = await hre.viem.deployContract("ERC20Mock", [
            "Reward Token",
            "RWD",
        ]);

        // Mint tokens
        await depositToken.write.mint([user.account?.address!, parseEther("25000")]);
        await depositToken.write.mint([user2.account?.address!, parseEther("25000")]);
        await depositToken.write.mint([user3.account?.address!, parseEther("25000")]);
        await rewardToken.write.mint([owner.account?.address!, fundRewards]);

        // Deploy staking contract
        const staking = await hre.viem.deployContract("MultiTierStaking", [
            depositToken.address,
            rewardToken.address,
            parseEther("5000"),   // silverThreshold
            parseEther("10000"),  // goldThreshold
            parseEther("20000"),  // diamondThreshold
            50_000n,              // silverBonus (5%)
            100_000n,             // goldBonus (10%)
            200_000n,             // diamondBonus (20%)
            10_000n,              // linearScale
            20n,                  // quadraticScale
            3_000_000_000_000n    // maxMultiplier
        ]);

        return { depositToken, rewardToken, staking };
    }

    async function increaseTime(seconds: number) {
        await hre.network.provider.send("evm_increaseTime", [seconds]);
        await hre.network.provider.send("evm_mine");
    }

    async function getCurrentTime(): Promise<bigint> {
        const block = await publicClient.getBlock();
        return block.timestamp;
    }

    describe("Deployment", () => {
        it("should deploy with correct initial state", async () => {
            const { depositToken, rewardToken, staking } = await deployContracts();

            // Check that contracts deployed successfully
            expect(staking.address).to.match(/^0x[a-fA-F0-9]{40}$/);
            expect(depositToken.address).to.match(/^0x[a-fA-F0-9]{40}$/);
            expect(rewardToken.address).to.match(/^0x[a-fA-F0-9]{40}$/);

            // Check initial state
            const totalRewards = await staking.read.totalRewards();
            expect(totalRewards).to.equal(0n);
        });
    });

    describe("Admin Functions", () => {
        it("should allow owner to add funding and set reward period", async () => {
            const { rewardToken, staking } = await deployContracts();

            await rewardToken.write.approve([staking.address, fundRewards], {
                account: owner.account,
            });

            await staking.write.addFunding([fundRewards], {
                account: owner.account,
            });

            // Check that funding was added
            const totalRewards = await staking.read.totalRewards();
            expect(totalRewards).to.equal(fundRewards);

            const currentTime = await getCurrentTime();
            await staking.write.setRewardPeriod([fundDurationDays, currentTime + 3600n], {
                account: owner.account,
            });

            // Check that reward period was set
            const rewardStartTime = await staking.read.rewardStartTime();
            expect(rewardStartTime).to.equal(currentTime + 3600n);
        });

        it("should not allow non-owner to add funding", async () => {
            const { rewardToken, staking } = await deployContracts();

            await rewardToken.write.mint([user.account?.address!, fundRewards]);
            await rewardToken.write.approve([staking.address, fundRewards], {
                account: user.account,
            });

            await expect(
                staking.write.addFunding([fundRewards], { account: user.account })
            ).to.be.rejectedWith("OwnableUnauthorizedAccount");
        });

        it("should allow owner to emergency stop", async () => {
            const { rewardToken, staking } = await deployContracts();

            // Setup funding and reward period
            await rewardToken.write.approve([staking.address, fundRewards], {
                account: owner.account,
            });
            await staking.write.addFunding([fundRewards], {
                account: owner.account,
            });

            const currentTime = await getCurrentTime();
            await staking.write.setRewardPeriod([fundDurationDays, currentTime + 60n], {
                account: owner.account,
            });

            // Wait for rewards to start
            await increaseTime(120);

            // Emergency stop should not revert
            await staking.write.emergencyStop({ account: owner.account });

            // Check that reward end time was updated
            const rewardEndTime = await staking.read.rewardEndTime();
            const blockTime = await getCurrentTime();
            expect(Number(rewardEndTime)).to.be.closeTo(Number(blockTime), 10);
        });
    });

    describe("Staking Functions", () => {
        async function setupStakingContract() {
            const contracts = await deployContracts();
            const { rewardToken, staking } = contracts;

            // Add funding
            await rewardToken.write.approve([staking.address, fundRewards], {
                account: owner.account,
            });
            await staking.write.addFunding([fundRewards], {
                account: owner.account,
            });

            // Set reward period to start soon
            const currentTime = await getCurrentTime();
            await staking.write.setRewardPeriod([fundDurationDays, currentTime + 60n], {
                account: owner.account,
            });

            // Wait for rewards to start
            await increaseTime(120);

            return contracts;
        }

        it("should allow user to deposit after rewards start", async () => {
            const { depositToken, staking } = await setupStakingContract();

            const depositAmount = parseEther("100");
            await depositToken.write.approve([staking.address, depositAmount], {
                account: user.account,
            });

            await staking.write.deposit([depositAmount, 1n], {
                account: user.account,
            });

            // Check that user has stakes
            const userStakes = await staking.read.getUserStakes([user.account?.address!]) as any[];
            expect(userStakes.length).to.equal(1);
            expect(userStakes[0].amount).to.equal(depositAmount);
        });

        it("should not allow deposit before rewards start", async () => {
            const { depositToken, rewardToken, staking } = await deployContracts();

            // Add funding but don't start rewards
            await rewardToken.write.approve([staking.address, fundRewards], {
                account: owner.account,
            });
            await staking.write.addFunding([fundRewards], {
                account: owner.account,
            });

            const depositAmount = parseEther("100");
            await depositToken.write.approve([staking.address, depositAmount], {
                account: user.account,
            });

            await expect(
                staking.write.deposit([depositAmount, 1n], { account: user.account })
            ).to.be.rejected;
        });

        it("should allow user to withdraw after lock period", async () => {
            const { depositToken, staking } = await setupStakingContract();

            const depositAmount = parseEther("100");
            await depositToken.write.approve([staking.address, depositAmount], {
                account: user.account,
            });

            await staking.write.deposit([depositAmount, 1n], {
                account: user.account,
            });

            // Fast-forward past lock period (1 day + buffer)
            await increaseTime(2 * 24 * 60 * 60);

            const beforeBal = await depositToken.read.balanceOf([user.account?.address!]);
            await staking.write.withdraw([0n], { account: user.account });
            const afterBal = await depositToken.read.balanceOf([user.account?.address!]);

            expect(afterBal - beforeBal).to.equal(depositAmount);
        });

        it("should not allow withdraw before lock period expires", async () => {
            const { depositToken, staking } = await setupStakingContract();

            const depositAmount = parseEther("100");
            await depositToken.write.approve([staking.address, depositAmount], {
                account: user.account,
            });

            await staking.write.deposit([depositAmount, 2n], {
                account: user.account,
            });

            // Try to withdraw immediately
            await expect(
                staking.write.withdraw([0n], { account: user.account })
            ).to.be.rejectedWith("Still locked");
        });
    });

    describe("Reward Calculations for Various Stake Types", () => {
        async function setupRewardTestContract() {
            const contracts = await deployContracts();
            const { rewardToken, staking } = contracts;

            // Add substantial funding
            const largeRewardAmount = parseEther("10000");
            await rewardToken.write.mint([owner.account?.address!, largeRewardAmount]);
            await rewardToken.write.approve([staking.address, largeRewardAmount], {
                account: owner.account,
            });
            await staking.write.addFunding([largeRewardAmount], {
                account: owner.account,
            });

            // Set reward period to start soon with longer duration for testing
            const currentTime = await getCurrentTime();
            await staking.write.setRewardPeriod([60n, currentTime + 60n], { // 60 days
                account: owner.account,
            });

            // Wait for rewards to start
            await increaseTime(120);

            return contracts;
        }

        it("should calculate different rewards based on threshold tiers", async () => {
            const { depositToken, staking } = await setupRewardTestContract();

            // Test different threshold amounts
            const baseAmount = parseEther("1000");        // Below silver threshold
            const silverAmount = parseEther("6000");      // Silver tier
            const goldAmount = parseEther("12000");       // Gold tier
            const diamondAmount = parseEther("25000");    // Diamond tier

            const lockDays = 7n; // Same lock period for all

            // User 1: Base tier
            await depositToken.write.approve([staking.address, baseAmount], {
                account: user.account,
            });
            await staking.write.deposit([baseAmount, lockDays], {
                account: user.account,
            });

            // User 2: Silver tier
            await depositToken.write.approve([staking.address, silverAmount], {
                account: user2.account,
            });
            await staking.write.deposit([silverAmount, lockDays], {
                account: user2.account,
            });

            // User 3: Gold tier
            await depositToken.write.approve([staking.address, goldAmount], {
                account: user3.account,
            });
            await staking.write.deposit([goldAmount, lockDays], {
                account: user3.account,
            });

            // Wait past lock period
            await increaseTime(8 * 24 * 60 * 60); // 8 days

            // Check pending rewards
            const baseRewards = await staking.read.pendingRewards([user.account?.address!]);
            const silverRewards = await staking.read.pendingRewards([user2.account?.address!]);
            const goldRewards = await staking.read.pendingRewards([user3.account?.address!]);

            console.log("Base rewards:", baseRewards.toString());
            console.log("Silver rewards:", silverRewards.toString());
            console.log("Gold rewards:", goldRewards.toString());

            // Silver should earn more than base due to threshold bonus
            expect(Number(silverRewards)).to.be.greaterThan(Number(baseRewards));

            // Gold should earn more than silver due to higher threshold bonus
            expect(Number(goldRewards)).to.be.greaterThan(Number(silverRewards));
        });

        it("should calculate different rewards based on lock duration", async () => {
            const { depositToken, staking } = await setupRewardTestContract();

            const amount = parseEther("5000"); // Same amount for all users

            // Different lock periods - all must be within reward period (60 days)
            const shortLock = 1n;   // 1 day
            const mediumLock = 7n;  // 7 days
            const longLock = 30n;   // 30 days

            // User 1: Short lock
            await depositToken.write.approve([staking.address, amount], {
                account: user.account,
            });
            await staking.write.deposit([amount, shortLock], {
                account: user.account,
            });

            // User 2: Medium lock
            await depositToken.write.approve([staking.address, amount], {
                account: user2.account,
            });
            await staking.write.deposit([amount, mediumLock], {
                account: user2.account,
            });

            // User 3: Long lock
            await depositToken.write.approve([staking.address, amount], {
                account: user3.account,
            });
            await staking.write.deposit([amount, longLock], {
                account: user3.account,
            });

            // Wait past longest lock period to ensure all rewards are available
            await increaseTime(31 * 24 * 60 * 60); // 31 days

            // Check pending rewards
            const shortRewards = await staking.read.pendingRewards([user.account?.address!]);
            const mediumRewards = await staking.read.pendingRewards([user2.account?.address!]);
            const longRewards = await staking.read.pendingRewards([user3.account?.address!]);

            console.log("Short lock rewards:", shortRewards.toString());
            console.log("Medium lock rewards:", mediumRewards.toString());
            console.log("Long lock rewards:", longRewards.toString());

            // Longer locks should earn more rewards due to time-based multiplier
            expect(Number(mediumRewards)).to.be.greaterThan(Number(shortRewards));
            expect(Number(longRewards)).to.be.greaterThan(Number(mediumRewards));
        });

        it("should handle multiple stakes from same user correctly", async () => {
            const { depositToken, staking } = await setupRewardTestContract();

            const amount1 = parseEther("3000");
            const amount2 = parseEther("8000"); // Will push total to silver tier
            const lockDays1 = 5n;
            const lockDays2 = 15n;

            // First stake - below silver threshold
            await depositToken.write.approve([staking.address, amount1], {
                account: user.account,
            });
            await staking.write.deposit([amount1, lockDays1], {
                account: user.account,
            });

            // Wait a bit
            await increaseTime(2 * 24 * 60 * 60); // 2 days

            // Second stake - different amount and lock period
            await depositToken.write.approve([staking.address, amount2], {
                account: user.account,
            });
            await staking.write.deposit([amount2, lockDays2], {
                account: user.account,
            });

            // Wait past first stake lock period
            await increaseTime(4 * 24 * 60 * 60); // 4 more days (6 total)

            const userStakes = await staking.read.getUserStakes([user.account?.address!]) as any[];
            expect(userStakes.length).to.equal(2);
            expect(userStakes[0].amount).to.equal(amount1);
            expect(userStakes[1].amount).to.equal(amount2);

            // Check pending rewards
            const pendingRewards = await staking.read.pendingRewards([user.account?.address!]);
            expect(Number(pendingRewards)).to.be.greaterThan(0);

            console.log("Multi-stake rewards:", pendingRewards.toString());
        });

        it("should distribute rewards proportionally among multiple users", async () => {
            const { depositToken, staking } = await setupRewardTestContract();

            // Three users with different stake amounts but same lock period
            const amount1 = parseEther("2000");
            const amount2 = parseEther("4000"); // 2x of user1
            const amount3 = parseEther("6000"); // 3x of user1
            const lockDays = 10n;

            // All users stake at the same time
            await depositToken.write.approve([staking.address, amount1], {
                account: user.account,
            });
            await staking.write.deposit([amount1, lockDays], {
                account: user.account,
            });

            await depositToken.write.approve([staking.address, amount2], {
                account: user2.account,
            });
            await staking.write.deposit([amount2, lockDays], {
                account: user2.account,
            });

            await depositToken.write.approve([staking.address, amount3], {
                account: user3.account,
            });
            await staking.write.deposit([amount3, lockDays], {
                account: user3.account,
            });

            // Wait past lock period
            await increaseTime(11 * 24 * 60 * 60); // 11 days

            // Check rewards
            const rewards1 = await staking.read.pendingRewards([user.account?.address!]);
            const rewards2 = await staking.read.pendingRewards([user2.account?.address!]);
            const rewards3 = await staking.read.pendingRewards([user3.account?.address!]);

            console.log("User 1 rewards:", rewards1.toString());
            console.log("User 2 rewards:", rewards2.toString());
            console.log("User 3 rewards:", rewards3.toString());

            // Rewards should be proportional to stake amounts (approximately)
            expect(Number(rewards2)).to.be.greaterThan(Number(rewards1));
            expect(Number(rewards3)).to.be.greaterThan(Number(rewards2));

            // User2 should have approximately 2x rewards of User1
            const ratio2to1 = Number(rewards2) / Number(rewards1);
            expect(ratio2to1).to.be.closeTo(2, 0.5); // Allow some tolerance

            // User3 should have approximately 3x rewards of User1
            const ratio3to1 = Number(rewards3) / Number(rewards1);
            expect(ratio3to1).to.be.closeTo(3, 0.5); // Allow some tolerance
        });

        it("should handle diamond tier with maximum multiplier correctly", async () => {
            const { depositToken, staking } = await setupRewardTestContract();

            const diamondAmount = parseEther("25000"); // Diamond tier
            const longLockDays = 30n; // Reduced to fit within 60-day reward period

            await depositToken.write.approve([staking.address, diamondAmount], {
                account: user.account,
            });
            await staking.write.deposit([diamondAmount, longLockDays], {
                account: user.account,
            });

            // Compare with smaller stake
            const smallAmount = parseEther("1000");
            const shortLockDays = 1n;

            await depositToken.write.approve([staking.address, smallAmount], {
                account: user2.account,
            });
            await staking.write.deposit([smallAmount, shortLockDays], {
                account: user2.account,
            });

            // Wait past both lock periods
            await increaseTime(31 * 24 * 60 * 60); // 31 days

            const diamondRewards = await staking.read.pendingRewards([user.account?.address!]);
            const smallRewards = await staking.read.pendingRewards([user2.account?.address!]);

            console.log("Diamond tier rewards:", diamondRewards.toString());
            console.log("Small stake rewards:", smallRewards.toString());

            // Diamond tier should earn significantly more
            expect(Number(diamondRewards)).to.be.greaterThan(Number(smallRewards));

            // The ratio should be substantial due to both amount and tier bonuses
            const ratio = Number(diamondRewards) / Number(smallRewards);
            expect(ratio).to.be.greaterThan(10); // Should be much higher due to multipliers
        });

        it("should accumulate rewards correctly over time", async () => {
            const { depositToken, staking } = await setupRewardTestContract();

            const amount = parseEther("5000");
            const lockDays = 7n;

            await depositToken.write.approve([staking.address, amount], {
                account: user.account,
            });
            await staking.write.deposit([amount, lockDays], {
                account: user.account,
            });

            // Wait past lock period
            await increaseTime(8 * 24 * 60 * 60); // 8 days

            // Check rewards at different time points
            const rewards1 = await staking.read.pendingRewards([user.account?.address!]);

            await increaseTime(7 * 24 * 60 * 60); // 7 more days
            const rewards2 = await staking.read.pendingRewards([user.account?.address!]);

            await increaseTime(7 * 24 * 60 * 60); // 7 more days
            const rewards3 = await staking.read.pendingRewards([user.account?.address!]);

            console.log("Rewards after 8 days:", rewards1.toString());
            console.log("Rewards after 15 days:", rewards2.toString());
            console.log("Rewards after 22 days:", rewards3.toString());

            // Rewards should increase over time
            expect(Number(rewards2)).to.be.greaterThan(Number(rewards1));
            expect(Number(rewards3)).to.be.greaterThan(Number(rewards2));
        });

        it("should handle claiming rewards correctly", async () => {
            const { depositToken, rewardToken, staking } = await setupRewardTestContract();

            const amount = parseEther("5000");
            const lockDays = 5n;

            await depositToken.write.approve([staking.address, amount], {
                account: user.account,
            });
            await staking.write.deposit([amount, lockDays], {
                account: user.account,
            });

            // Wait past lock period
            await increaseTime(6 * 24 * 60 * 60); // 6 days

            const pendingBefore = await staking.read.pendingRewards([user.account?.address!]);
            const balanceBefore = await rewardToken.read.balanceOf([user.account?.address!]);

            // Claim rewards
            await staking.write.claim({ account: user.account });

            const pendingAfter = await staking.read.pendingRewards([user.account?.address!]);
            const balanceAfter = await rewardToken.read.balanceOf([user.account?.address!]);

            console.log("Pending before claim:", pendingBefore.toString());
            console.log("Pending after claim:", pendingAfter.toString());
            console.log("Balance increase:", (balanceAfter - balanceBefore).toString());

            // Pending rewards should be reset to 0 (or very small due to timestamp differences)
            expect(Number(pendingAfter)).to.be.lessThan(Number(pendingBefore) / 1000);

            // Balance should increase by approximately the pending amount
            expect(Number(balanceAfter - balanceBefore)).to.be.closeTo(Number(pendingBefore), Number(parseEther("0.1")));
        });
    });

    describe("Emergency Functions", () => {
        async function setupStakingContract() {
            const contracts = await deployContracts();
            const { rewardToken, staking } = contracts;

            await rewardToken.write.approve([staking.address, fundRewards], {
                account: owner.account,
            });
            await staking.write.addFunding([fundRewards], {
                account: owner.account,
            });

            const currentTime = await getCurrentTime();
            await staking.write.setRewardPeriod([fundDurationDays, currentTime + 60n], {
                account: owner.account,
            });

            await increaseTime(120);
            return contracts;
        }

        it("should allow user to emergency withdraw all stakes", async () => {
            const { depositToken, staking } = await setupStakingContract();

            const depositAmount = parseEther("100");

            // Make multiple deposits
            await depositToken.write.approve([staking.address, depositAmount * 3n], {
                account: user.account,
            });
            await staking.write.deposit([depositAmount, 7n], { account: user.account });
            await staking.write.deposit([depositAmount, 14n], { account: user.account });
            await staking.write.deposit([depositAmount, 21n], { account: user.account });

            const beforeBal = await depositToken.read.balanceOf([user.account?.address!]);

            // Emergency withdraw all
            await staking.write.emergencyWithdrawAll({ account: user.account });

            const afterBal = await depositToken.read.balanceOf([user.account?.address!]);

            // Should get back all deposited tokens
            expect(afterBal - beforeBal).to.equal(depositAmount * 3n);

            // Should have no stakes left
            const userStakes = await staking.read.getUserStakes([user.account?.address!]) as any[];
            expect(userStakes.length).to.equal(0);
        });
    });

    describe("View Functions", () => {
        async function setupStakingContract() {
            const contracts = await deployContracts();
            const { rewardToken, staking } = contracts;

            await rewardToken.write.approve([staking.address, fundRewards], {
                account: owner.account,
            });
            await staking.write.addFunding([fundRewards], {
                account: owner.account,
            });

            const currentTime = await getCurrentTime();
            await staking.write.setRewardPeriod([fundDurationDays, currentTime + 60n], {
                account: owner.account,
            });

            await increaseTime(120);
            return contracts;
        }

        it("should return correct user stakes", async () => {
            const { depositToken, staking } = await setupStakingContract();

            // Initially no stakes
            let userStakes = await staking.read.getUserStakes([user.account?.address!]) as any[];
            expect(userStakes.length).to.equal(0);

            // Make a deposit
            const depositAmount = parseEther("1000");
            await depositToken.write.approve([staking.address, depositAmount], {
                account: user.account,
            });
            await staking.write.deposit([depositAmount, 7n], { account: user.account });

            // Should have one stake
            userStakes = await staking.read.getUserStakes([user.account?.address!]) as any[];
            expect(userStakes.length).to.equal(1);
            expect(userStakes[0].amount).to.equal(depositAmount);
        });

        it("should calculate pending rewards correctly", async () => {
            const { depositToken, staking } = await setupStakingContract();

            const depositAmount = parseEther("1000");
            await depositToken.write.approve([staking.address, depositAmount], {
                account: user.account,
            });
            await staking.write.deposit([depositAmount, 1n], { account: user.account });

            // Fast-forward past lock period
            await increaseTime(2 * 24 * 60 * 60);

            // Should have some pending rewards
            const pendingRewards = await staking.read.pendingRewards([user.account?.address!]);
            expect(Number(pendingRewards)).to.be.greaterThan(0);
        });
    });
}); 