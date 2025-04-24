import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const USDTModule = buildModule("USDTModule", (m) => {

  const token = m.contract("USDT", []);

  return { token };
});

export default USDTModule;