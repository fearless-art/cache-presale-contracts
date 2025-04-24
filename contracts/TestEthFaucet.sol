// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract TestEthFaucet {
    // Event to log when ETH is given
    event EthGiven(address indexed recipient, uint256 amount);
    
    // Allow the contract to receive ETH
    receive() external payable {}
    
    // Fallback function in case someone sends ETH with data
    fallback() external payable {}
    
    // Function to give 0.05 ETH to the caller
    function give(address _recipient) external {
        require(
            address(this).balance >= 0.1 ether,
            "Faucet is empty"
        );
        
        require(
            _recipient != address(0),
            "Invalid address"
        );
        
        // Transfer 0.05 ETH to the caller
        (bool sent, ) = _recipient.call{value: 0.1 ether}("");
        require(sent, "Failed to send ETH");
        
        emit EthGiven(_recipient, 0.1 ether);
    }
    
    // Function to check contract's balance
    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
} 