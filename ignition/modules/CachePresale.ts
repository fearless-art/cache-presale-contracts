// This setup uses Hardhat Ignition to manage smart contract deployments.
// Learn more about it at https://hardhat.org/ignition

import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const CachePresaleModule = buildModule("CachePresaleModule", (m) => {
  // Get deployment parameters with default values
  const adminSigner = m.getParameter(
    "adminSigner",
    "0x5419aD1442f2AFFAfa665d197E07d983f651C5b9"
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
