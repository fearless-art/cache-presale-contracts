// This setup uses Hardhat Ignition to manage smart contract deployments.
// Learn more about it at https://hardhat.org/ignition

import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { parseEther } from "viem";

const CachePresaleModule = buildModule("CachePresaleModule", (m) => {
  // Get deployment parameters with default values
  const adminSigner = m.getParameter(
    "_adminSigner",
    "0x5419aD1442f2AFFAfa665d197E07d983f651C5b9"
  );

  const treasury = m.getParameter(
    "_treasury",
    "0x604daCE67C75529b740544876b4dABB787B7eC9b"
  );

  const tokenSaleHardCap = m.getParameter(
    "_tokenSaleHardCap",
    parseEther("25000000")
  );

  // Deploy CachePresale contract
  const cachePresale = m.contract("CachePresale", [
    adminSigner,
    treasury,
    tokenSaleHardCap,
  ]);

  return { cachePresale };
});

export default CachePresaleModule;
