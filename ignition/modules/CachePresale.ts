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
    "0x604daCE67C75529b740544876b4dABB787B7eC9b"
  );

  // Deploy CachePresale contract
  const cachePresale = m.contract("CachePresale", [adminSigner, treasury]);

  return { cachePresale };
});

export default CachePresaleModule;
