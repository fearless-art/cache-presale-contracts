// This setup uses Hardhat Ignition to manage smart contract deployments.
// Learn more about it at https://hardhat.org/ignition

import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const CachePresaleModule = buildModule("CachePresaleModule", (m) => {
  // Get deployment parameters with default values
  const adminSigner = m.getParameter(
    "adminSigner",
    "0xAFB90ee4388CE8c79F1Fd35A4229C108AdA27Ba6"
  );
  
  const treasury = m.getParameter(
    "treasury",
    "0x625e9A48D858662e14E841494A3790CB6195Ab54"
  );

  // Deploy CachePresale contract
  const cachePresale = m.contract("CachePresale", [adminSigner, treasury]);

  return { cachePresale };
});

export default CachePresaleModule;
