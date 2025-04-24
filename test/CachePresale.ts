import { expect } from "chai";
import hre from "hardhat";
import { type PublicClient, type WalletClient, parseEther, parseUnits, getAddress } from "viem";

// Helper function to normalize addresses for comparison
function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

describe("CachePresale", () => {
  // Test variables
  let owner: WalletClient;
  let admin: WalletClient;
  let treasury: WalletClient;
  let user: WalletClient;
  let user2: WalletClient;
  let publicClient: PublicClient;

  // Current timestamp for testing signatures
  let currentTimestamp: number;

  async function deployContracts() {
    // Get test accounts
    [owner, admin, treasury, user, user2] = await hre.viem.getWalletClients();
    publicClient = await hre.viem.getPublicClient();

    const usdc = (await hre.viem.deployContract("USDC", []));
    const usdt = (await hre.viem.deployContract("USDT", []));
    const presale = (await hre.viem.deployContract("CachePresale", [
      admin.account?.address!,
      treasury.account?.address!
    ]));

    // Mint some tokens to user for testing
    await usdc.write.mint([user.account?.address!, parseUnits("1000", 6)]);
    await usdt.write.mint([user.account?.address!, parseUnits("1000", 6)]);

    // Mint tokens to user2 as well
    await usdc.write.mint([user2.account?.address!, parseUnits("1000", 6)]);
    await usdt.write.mint([user2.account?.address!, parseUnits("1000", 6)]);

    // Get current block timestamp for signature creation
    const block = await publicClient.getBlock();
    currentTimestamp = Number(block.timestamp);

    return { usdc, usdt, presale };
  }

  describe("Deployment", () => {
    it("should deploy with correct initial state", async () => {
      const { presale } = await deployContracts();

      const admin_ = await presale.read.adminSigner() as string;
      const treasury_ = await presale.read.treasury() as string;

      expect(normalizeAddress(admin_)).to.equal(normalizeAddress(admin.account?.address!));
      expect(normalizeAddress(treasury_)).to.equal(normalizeAddress(treasury.account?.address!));
    });

    it("should have the correct hard cap", async () => {
      const { presale } = await deployContracts();

      const hardCap = await presale.read.TOKEN_SALE_HARD_CAP();
      expect(hardCap).to.equal(parseEther("25000000")); // 25 million CACHE tokens
    });
  });

  describe("Buy Cache With ERC20 Tokens", () => {
    it("should allow buying Cache with USDC", async () => {
      const { usdc, presale } = await deployContracts();

      // Prepare parameters for buyCache
      const paymentToken = usdc.address;
      const amountPaid = parseUnits("100", 6); // 100 USDC
      const amountReceived = parseEther("1000"); // 1000 CACHE tokens
      const timeSigned = BigInt(currentTimestamp + 60); // 1 minute in the future
      const salt = 123n;

      // Create domain for EIP-712 signature
      const domain = {
        name: "CachePresale",
        version: "1",
        chainId: 1337n, // Hardhat chain ID
        verifyingContract: getAddress(presale.address),
      };

      // Define types for EIP-712 signature
      const types = {
        BuyCacheMessage: [
          { name: "paymentToken", type: "address" },
          { name: "amountPaid", type: "uint256" },
          { name: "amountReceived", type: "uint256" },
          { name: "timeSigned", type: "uint256" },
          { name: "salt", type: "uint256" },
        ],
      };

      // Create message to sign
      const message = {
        paymentToken: paymentToken,
        amountPaid: amountPaid,
        amountReceived: amountReceived,
        timeSigned: timeSigned,
        salt: salt,
      };

      // Get signature from admin
      const signature = await admin.signTypedData({
        account: admin.account!,
        domain,
        types,
        primaryType: "BuyCacheMessage",
        message,
      });

      // Approve tokens for the presale contract
      await usdc.write.approve([presale.address, amountPaid], {
        account: user.account,
      });

      // Use the tokens to buy Cache
      await presale.write.buyCache([
        paymentToken,
        amountPaid,
        amountReceived,
        Number(timeSigned),
        salt,
        signature,
      ], {
        account: user.account,
      });

      // Check that the user received the correct amount of CACHE tokens
      const userCache = await presale.read.getUserTotalCache([user.account?.address!]);
      expect(userCache).to.equal(amountReceived);

      // Check that contract state is updated correctly
      const tokensSold = await presale.read.tokensSold();
      expect(tokensSold).to.equal(amountReceived);

      // Check the purchase history
      const purchases = await presale.read.getUserPurchases([user.account?.address!]) as any[];
      expect(purchases.length).to.equal(1);
      expect(purchases[0].purchaseAmount).to.equal(amountReceived);
    });

    it("should allow buying Cache with USDT", async () => {
      const { usdt, presale } = await deployContracts();

      // Prepare parameters for buyCache
      const paymentToken = usdt.address;
      const amountPaid = parseUnits("100", 6); // 100 USDT
      const amountReceived = parseEther("1000"); // 1000 CACHE tokens
      const timeSigned = BigInt(currentTimestamp + 60); // 1 minute in the future
      const salt = 123n;

      // Create domain for EIP-712 signature
      const domain = {
        name: "CachePresale",
        version: "1",
        chainId: 1337n, // Hardhat chain ID
        verifyingContract: getAddress(presale.address),
      };

      // Define types for EIP-712 signature
      const types = {
        BuyCacheMessage: [
          { name: "paymentToken", type: "address" },
          { name: "amountPaid", type: "uint256" },
          { name: "amountReceived", type: "uint256" },
          { name: "timeSigned", type: "uint256" },
          { name: "salt", type: "uint256" },
        ],
      };

      // Create message to sign
      const message = {
        paymentToken: paymentToken,
        amountPaid: amountPaid,
        amountReceived: amountReceived,
        timeSigned: timeSigned,
        salt: salt,
      };

      // Get signature from admin
      const signature = await admin.signTypedData({
        account: admin.account!,
        domain,
        types,
        primaryType: "BuyCacheMessage",
        message,
      });

      // Approve tokens for the presale contract
      await usdt.write.approve([presale.address, amountPaid], {
        account: user.account,
      });

      // Use the tokens to buy Cache
      await presale.write.buyCache([
        paymentToken,
        amountPaid,
        amountReceived,
        Number(timeSigned),
        salt,
        signature,
      ], {
        account: user.account,
      });

      // Check that the user received the correct amount of CACHE tokens
      const userCache = await presale.read.getUserTotalCache([user.account?.address!]);
      expect(userCache).to.equal(amountReceived);

      // Check that contract state is updated correctly
      const tokensSold = await presale.read.tokensSold();
      expect(tokensSold).to.equal(amountReceived);
    });

    it("should fail if signature is already used", async () => {
      const { usdc, presale } = await deployContracts();

      // Prepare parameters for buyCache
      const paymentToken = usdc.address;
      const amountPaid = parseUnits("100", 6); // 100 USDC
      const amountReceived = parseEther("1000"); // 1000 CACHE tokens
      const timeSigned = BigInt(currentTimestamp + 60); // 1 minute in the future
      const salt = 123n;

      // Create domain for EIP-712 signature
      const domain = {
        name: "CachePresale",
        version: "1",
        chainId: 1337n, // Hardhat chain ID
        verifyingContract: getAddress(presale.address),
      };

      // Define types for EIP-712 signature
      const types = {
        BuyCacheMessage: [
          { name: "paymentToken", type: "address" },
          { name: "amountPaid", type: "uint256" },
          { name: "amountReceived", type: "uint256" },
          { name: "timeSigned", type: "uint256" },
          { name: "salt", type: "uint256" },
        ],
      };

      // Create message to sign
      const message = {
        paymentToken: paymentToken,
        amountPaid: amountPaid,
        amountReceived: amountReceived,
        timeSigned: timeSigned,
        salt: salt,
      };

      // Get signature from admin
      const signature = await admin.signTypedData({
        account: admin.account!,
        domain,
        types,
        primaryType: "BuyCacheMessage",
        message,
      });

      // Approve tokens for the presale contract (use a multiple of amountPaid)
      await usdc.write.approve([presale.address, amountPaid * 2n], {
        account: user.account,
      });

      // Use the tokens to buy Cache
      await presale.write.buyCache([
        paymentToken,
        amountPaid,
        amountReceived,
        Number(timeSigned),
        salt,
        signature,
      ], {
        account: user.account,
      });

      // Try to use same signature again, should fail
      await expect(presale.write.buyCache([
        paymentToken,
        amountPaid,
        amountReceived,
        Number(timeSigned),
        salt,
        signature,
      ], {
        account: user.account,
      })).to.be.rejectedWith("Signature already used");
    });

    it("should fail if signature is expired", async () => {
      const { usdc, presale } = await deployContracts();

      // Prepare parameters for buyCache with expired timestamp
      const paymentToken = usdc.address;
      const amountPaid = parseUnits("100", 6); // 100 USDC
      const amountReceived = parseEther("1000"); // 1000 CACHE tokens
      const timeSigned = BigInt(currentTimestamp - 3700); // Over 1 hour in the past
      const salt = 123n;

      // Create domain for EIP-712 signature
      const domain = {
        name: "CachePresale",
        version: "1",
        chainId: 1337n, // Hardhat chain ID
        verifyingContract: getAddress(presale.address),
      };

      // Define types for EIP-712 signature
      const types = {
        BuyCacheMessage: [
          { name: "paymentToken", type: "address" },
          { name: "amountPaid", type: "uint256" },
          { name: "amountReceived", type: "uint256" },
          { name: "timeSigned", type: "uint256" },
          { name: "salt", type: "uint256" },
        ],
      };

      // Create message to sign
      const message = {
        paymentToken: paymentToken,
        amountPaid: amountPaid,
        amountReceived: amountReceived,
        timeSigned: timeSigned,
        salt: salt,
      };

      // Get signature from admin
      const signature = await admin.signTypedData({
        account: admin.account!,
        domain,
        types,
        primaryType: "BuyCacheMessage",
        message,
      });

      // Approve tokens for the presale contract
      await usdc.write.approve([presale.address, amountPaid], {
        account: user.account,
      });

      // Try to use expired signature, should fail
      await expect(presale.write.buyCache([
        paymentToken,
        amountPaid,
        amountReceived,
        Number(timeSigned),
        salt,
        signature,
      ], {
        account: user.account,
      })).to.be.rejectedWith("Signature expired");
    });

    it("should fail if token sale hard cap is reached", async () => {
      const { usdc, presale } = await deployContracts();

      // Get the hard cap
      const hardCap = await presale.read.TOKEN_SALE_HARD_CAP();

      // Prepare parameters for buyCache with amount that would exceed hard cap
      const paymentToken = usdc.address;
      const amountPaid = parseUnits("2500000", 6); // Large payment
      const amountReceived = hardCap + 1n; // Trying to buy more than hard cap
      const timeSigned = BigInt(currentTimestamp + 60); // 1 minute in the future
      const salt = 123n;

      // Create domain for EIP-712 signature
      const domain = {
        name: "CachePresale",
        version: "1",
        chainId: 1337n, // Hardhat chain ID
        verifyingContract: getAddress(presale.address),
      };

      // Define types for EIP-712 signature
      const types = {
        BuyCacheMessage: [
          { name: "paymentToken", type: "address" },
          { name: "amountPaid", type: "uint256" },
          { name: "amountReceived", type: "uint256" },
          { name: "timeSigned", type: "uint256" },
          { name: "salt", type: "uint256" },
        ],
      };

      // Create message to sign
      const message = {
        paymentToken: paymentToken,
        amountPaid: amountPaid,
        amountReceived: amountReceived,
        timeSigned: timeSigned,
        salt: salt,
      };

      // Get signature from admin
      const signature = await admin.signTypedData({
        account: admin.account!,
        domain,
        types,
        primaryType: "BuyCacheMessage",
        message,
      });

      // Mint more tokens for the large purchase
      await usdc.write.mint([user.account?.address!, amountPaid]);

      // Approve tokens for the presale contract
      await usdc.write.approve([presale.address, amountPaid], {
        account: user.account,
      });

      // Try to buy more than hard cap, should fail
      await expect(presale.write.buyCache([
        paymentToken,
        amountPaid,
        amountReceived,
        Number(timeSigned),
        salt,
        signature,
      ], {
        account: user.account,
      })).to.be.rejectedWith("Token sale hard cap reached");
    });

    it("should enforce hard cap across multiple purchases", async () => {
      const { usdc, presale } = await deployContracts();

      // Get the hard cap
      const hardCap = await presale.read.TOKEN_SALE_HARD_CAP();

      // First purchase - just below half of hard cap
      const firstAmount = hardCap / 2n - parseEther("100");

      // First purchase parameters
      const paymentToken = usdc.address;
      const amountPaid1 = parseUnits("1000000", 6);
      const amountReceived1 = firstAmount;
      const timeSigned1 = BigInt(currentTimestamp + 60);
      const salt1 = 123n;

      // Second purchase - just below half of hard cap for user2
      const secondAmount = hardCap / 2n - parseEther("100");

      // Second purchase parameters
      const amountPaid2 = parseUnits("1000000", 6);
      const amountReceived2 = secondAmount;
      const timeSigned2 = BigInt(currentTimestamp + 120);
      const salt2 = 456n;

      // Third purchase - small amount that would exceed the cap
      const thirdAmount = parseEther("300");

      // Third purchase parameters
      const amountPaid3 = parseUnits("30", 6);
      const amountReceived3 = thirdAmount;
      const timeSigned3 = BigInt(currentTimestamp + 180);
      const salt3 = 789n;

      // Create domain for EIP-712 signature
      const domain = {
        name: "CachePresale",
        version: "1",
        chainId: 1337n,
        verifyingContract: getAddress(presale.address),
      };

      // Define types for EIP-712 signature
      const types = {
        BuyCacheMessage: [
          { name: "paymentToken", type: "address" },
          { name: "amountPaid", type: "uint256" },
          { name: "amountReceived", type: "uint256" },
          { name: "timeSigned", type: "uint256" },
          { name: "salt", type: "uint256" },
        ],
      };

      // First purchase message
      const message1 = {
        paymentToken: paymentToken,
        amountPaid: amountPaid1,
        amountReceived: amountReceived1,
        timeSigned: timeSigned1,
        salt: salt1,
      };

      // Second purchase message
      const message2 = {
        paymentToken: paymentToken,
        amountPaid: amountPaid2,
        amountReceived: amountReceived2,
        timeSigned: timeSigned2,
        salt: salt2,
      };

      // Third purchase message
      const message3 = {
        paymentToken: paymentToken,
        amountPaid: amountPaid3,
        amountReceived: amountReceived3,
        timeSigned: timeSigned3,
        salt: salt3,
      };

      // Get signatures from admin
      const signature1 = await admin.signTypedData({
        account: admin.account!,
        domain,
        types,
        primaryType: "BuyCacheMessage",
        message: message1,
      });

      const signature2 = await admin.signTypedData({
        account: admin.account!,
        domain,
        types,
        primaryType: "BuyCacheMessage",
        message: message2,
      });

      const signature3 = await admin.signTypedData({
        account: admin.account!,
        domain,
        types,
        primaryType: "BuyCacheMessage",
        message: message3,
      });

      // Mint more tokens for the large purchases
      await usdc.write.mint([user.account?.address!, amountPaid1]);
      await usdc.write.mint([user2.account?.address!, amountPaid2 + amountPaid3]);

      // Approve tokens for the first purchase
      await usdc.write.approve([presale.address, amountPaid1], {
        account: user.account,
      });

      // First purchase should succeed
      await presale.write.buyCache([
        paymentToken,
        amountPaid1,
        amountReceived1,
        Number(timeSigned1),
        salt1,
        signature1,
      ], {
        account: user.account,
      });

      // Approve tokens for the second purchase
      await usdc.write.approve([presale.address, amountPaid2], {
        account: user2.account,
      });

      // Second purchase should succeed
      await presale.write.buyCache([
        paymentToken,
        amountPaid2,
        amountReceived2,
        Number(timeSigned2),
        salt2,
        signature2,
      ], {
        account: user2.account,
      });

      // Check total tokens sold
      const tokensSold = await presale.read.tokensSold();
      expect(tokensSold).to.equal(amountReceived1 + amountReceived2);

      // Approve tokens for the third purchase
      await usdc.write.approve([presale.address, amountPaid3], {
        account: user2.account,
      });

      // Third purchase should fail because it would exceed the hard cap
      await expect(presale.write.buyCache([
        paymentToken,
        amountPaid3,
        amountReceived3,
        Number(timeSigned3),
        salt3,
        signature3,
      ], {
        account: user2.account,
      })).to.be.rejectedWith("Token sale hard cap reached");
    });
  });

  describe("Buy Cache With ETH", () => {
    it("should allow buying Cache with ETH", async () => {
      const { presale } = await deployContracts();

      // Prepare parameters for buyCacheWithEth
      const amountPaid = parseEther("1"); // 1 ETH
      const amountReceived = parseEther("5000"); // 5000 CACHE tokens
      const timeSigned = BigInt(currentTimestamp + 60); // 1 minute in the future
      const salt = 456n;

      // Create domain for EIP-712 signature
      const domain = {
        name: "CachePresale",
        version: "1",
        chainId: 1337n, // Hardhat chain ID
        verifyingContract: getAddress(presale.address),
      };

      // Define types for EIP-712 signature
      const types = {
        BuyCacheWithEthMessage: [
          { name: "amountPaid", type: "uint256" },
          { name: "amountReceived", type: "uint256" },
          { name: "timeSigned", type: "uint256" },
          { name: "salt", type: "uint256" },
        ],
      };

      // Create message to sign
      const message = {
        amountPaid: amountPaid,
        amountReceived: amountReceived,
        timeSigned: timeSigned,
        salt: salt,
      };

      // Get signature from admin
      const signature = await admin.signTypedData({
        account: admin.account!,
        domain,
        types,
        primaryType: "BuyCacheWithEthMessage",
        message,
      });

      // Use ETH to buy Cache
      await presale.write.buyCacheWithEth([
        amountPaid,
        amountReceived,
        Number(timeSigned),
        salt,
        signature,
      ], {
        account: user.account,
        value: amountPaid,
      });

      // Check that the user received the correct amount of CACHE tokens
      const userCache = await presale.read.getUserTotalCache([user.account?.address!]);
      expect(userCache).to.equal(amountReceived);

      // Check that contract state is updated correctly
      const tokensSold = await presale.read.tokensSold();
      expect(tokensSold).to.equal(amountReceived);

      // Check the purchase history
      const purchases = await presale.read.getUserPurchases([user.account?.address!]) as any[];
      expect(purchases.length).to.equal(1);
      expect(purchases[0].purchaseAmount).to.equal(amountReceived);
    });

    it("should fail if ETH amount does not match signed amount", async () => {
      const { presale } = await deployContracts();

      // Prepare parameters for buyCacheWithEth
      const amountPaid = parseEther("1"); // 1 ETH
      const amountReceived = parseEther("5000"); // 5000 CACHE tokens
      const timeSigned = BigInt(currentTimestamp + 60); // 1 minute in the future
      const salt = 456n;

      // Create domain for EIP-712 signature
      const domain = {
        name: "CachePresale",
        version: "1",
        chainId: 1337n, // Hardhat chain ID
        verifyingContract: getAddress(presale.address),
      };

      // Define types for EIP-712 signature
      const types = {
        BuyCacheWithEthMessage: [
          { name: "amountPaid", type: "uint256" },
          { name: "amountReceived", type: "uint256" },
          { name: "timeSigned", type: "uint256" },
          { name: "salt", type: "uint256" },
        ],
      };

      // Create message to sign
      const message = {
        amountPaid: amountPaid,
        amountReceived: amountReceived,
        timeSigned: timeSigned,
        salt: salt,
      };

      // Get signature from admin
      const signature = await admin.signTypedData({
        account: admin.account!,
        domain,
        types,
        primaryType: "BuyCacheWithEthMessage",
        message,
      });

      // Try to buy with wrong ETH amount, should fail
      await expect(presale.write.buyCacheWithEth([
        amountPaid,
        amountReceived,
        Number(timeSigned),
        salt,
        signature,
      ], {
        account: user.account,
        value: parseEther("0.5"), // Only sending 0.5 ETH
      })).to.be.rejectedWith("ETH amount mismatch");
    });

    it("should reject direct ETH transfers", async () => {
      const { presale } = await deployContracts();

      // Try to send ETH directly to the contract
      await expect(
        user.sendTransaction({
          account: user.account!,
          to: presale.address,
          value: parseEther("1"),
          chain: null
        })
      ).to.be.rejectedWith("Use buyCacheWithEth instead");
    });
  });

  describe("Admin Functions", () => {
    it("should allow owner to pause and unpause the contract", async () => {
      const { usdc, presale } = await deployContracts();

      // Owner pauses the contract
      await presale.write.pause({
        account: owner.account,
      });

      // Prepare parameters for buyCache
      const paymentToken = usdc.address;
      const amountPaid = parseUnits("100", 6); // 100 USDC
      const amountReceived = parseEther("1000"); // 1000 CACHE tokens
      const timeSigned = BigInt(currentTimestamp + 60); // 1 minute in the future
      const salt = 123n;

      // Create domain for EIP-712 signature
      const domain = {
        name: "CachePresale",
        version: "1",
        chainId: 1337n, // Hardhat chain ID
        verifyingContract: getAddress(presale.address),
      };

      // Define types for EIP-712 signature
      const types = {
        BuyCacheMessage: [
          { name: "paymentToken", type: "address" },
          { name: "amountPaid", type: "uint256" },
          { name: "amountReceived", type: "uint256" },
          { name: "timeSigned", type: "uint256" },
          { name: "salt", type: "uint256" },
        ],
      };

      // Create message to sign
      const message = {
        paymentToken: paymentToken,
        amountPaid: amountPaid,
        amountReceived: amountReceived,
        timeSigned: timeSigned,
        salt: salt,
      };

      // Get signature from admin
      const signature = await admin.signTypedData({
        account: admin.account!,
        domain,
        types,
        primaryType: "BuyCacheMessage",
        message,
      });

      // Approve tokens for the presale contract
      await usdc.write.approve([presale.address, amountPaid], {
        account: user.account,
      });

      // Try to buy while contract is paused, should fail
      await expect(presale.write.buyCache([
        paymentToken,
        amountPaid,
        amountReceived,
        Number(timeSigned),
        salt,
        signature,
      ], {
        account: user.account,
      })).to.be.rejectedWith("EnforcedPause");

      // Owner unpauses the contract
      await presale.write.unpause({
        account: owner.account,
      });

      // Now buying should succeed
      await presale.write.buyCache([
        paymentToken,
        amountPaid,
        amountReceived,
        Number(timeSigned),
        salt,
        signature,
      ], {
        account: user.account,
      });

      // Check that the purchase succeeded
      const userCache = await presale.read.getUserTotalCache([user.account?.address!]);
      expect(userCache).to.equal(amountReceived);
    });

    it("should not allow non-owner to pause the contract", async () => {
      const { presale } = await deployContracts();

      // Try to pause with non-owner account, should fail
      await expect(presale.write.pause({
        account: user.account,
      })).to.be.rejectedWith("OwnableUnauthorizedAccount");
    });
  });

  describe("View Functions", () => {
    it("should correctly retrieve user purchase history", async () => {
      const { usdc, presale } = await deployContracts();

      // Make two purchases with different amounts
      for (let i = 0; i < 2; i++) {
        // Prepare parameters for buyCache
        const paymentToken = usdc.address;
        const amountPaid = parseUnits(`${50 * (i + 1)}`, 6); // 50 or 100 USDC
        const amountReceived = parseEther(`${500 * (i + 1)}`); // 500 or 1000 CACHE tokens
        const timeSigned = BigInt(currentTimestamp + 60 + i); // Slightly different timestamps
        const salt = BigInt(123 + i); // Different salts

        // Create domain for EIP-712 signature
        const domain = {
          name: "CachePresale",
          version: "1",
          chainId: 1337n, // Hardhat chain ID
          verifyingContract: getAddress(presale.address),
        };

        // Define types for EIP-712 signature
        const types = {
          BuyCacheMessage: [
            { name: "paymentToken", type: "address" },
            { name: "amountPaid", type: "uint256" },
            { name: "amountReceived", type: "uint256" },
            { name: "timeSigned", type: "uint256" },
            { name: "salt", type: "uint256" },
          ],
        };

        // Create message to sign
        const message = {
          paymentToken: paymentToken,
          amountPaid: amountPaid,
          amountReceived: amountReceived,
          timeSigned: timeSigned,
          salt: salt,
        };

        // Get signature from admin
        const signature = await admin.signTypedData({
          account: admin.account!,
          domain,
          types,
          primaryType: "BuyCacheMessage",
          message,
        });

        // Approve tokens for the presale contract
        await usdc.write.approve([presale.address, amountPaid], {
          account: user.account,
        });

        // Buy Cache
        await presale.write.buyCache([
          paymentToken,
          amountPaid,
          amountReceived,
          Number(timeSigned),
          salt,
          signature,
        ], {
          account: user.account,
        });
      }

      // Get purchase history
      const purchases = await presale.read.getUserPurchases([user.account?.address!]) as any[];

      // Verify history
      expect(purchases.length).to.equal(2);
      expect(purchases[0].purchaseAmount).to.equal(parseEther("500"));
      expect(purchases[1].purchaseAmount).to.equal(parseEther("1000"));

      // Check total Cache
      const totalCache = await presale.read.getUserTotalCache([user.account?.address!]);
      expect(totalCache).to.equal(parseEther("1500"));
    });

    it("should return empty array for users with no purchases", async () => {
      const { presale } = await deployContracts();

      // Get purchase history for user with no purchases
      const purchases = await presale.read.getUserPurchases([user.account?.address!]) as any[];

      // Verify empty history
      expect(purchases.length).to.equal(0);

      // Check zero total Cache
      const totalCache = await presale.read.getUserTotalCache([user.account?.address!]);
      expect(totalCache).to.equal(0n);
    });
  });
}); 