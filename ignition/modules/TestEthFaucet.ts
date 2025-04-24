import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const TestEthFaucetModule = buildModule("TestEthFaucetModule", (m) => {
  // Deploy the TestEthFaucet contract
  const faucet = m.contract("TestEthFaucet", []);

  return { faucet };
});

export default TestEthFaucetModule; 