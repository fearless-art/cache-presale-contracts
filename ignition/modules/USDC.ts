import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const USDCModule = buildModule("USDCModule", (m) => {

  const token = m.contract("USDC", []);

  return { token };
});

export default USDCModule;