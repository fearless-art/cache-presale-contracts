// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

contract PresaleRegister is EIP712, Ownable2Step, Pausable {
    using ECDSA for bytes32;
    using SafeERC20 for IERC20;
    address public adminSigner;
    address public treasury;

    uint256 public tokenSaleHardCap = 25_000_000 ether;
    uint256 public tokensSold;

    // Struct to store purchase details
    struct Purchase {
        uint256 date;
        uint256 purchaseAmount;
    }

    struct BuyTokensMessage {
        address paymentToken;
        uint256 amountPaid;
        uint256 amountReceived;
        uint256 timeSigned;
        uint256 salt;
    }

    struct BuyTokensWithEthMessage {
        uint256 amountPaid;
        uint256 amountReceived;
        uint256 timeSigned;
        uint256 salt;
    }

    mapping(address => uint256) public userTotalTokens;
    mapping(address => Purchase[]) public userPurchases;

    // Event emitted on successful purchase
    event TokensPurchased(
        address indexed buyer,
        address indexed paymentToken,
        uint256 amountPaid,
        uint256 amountReceived,
        uint256 date
    );

    // Event for used signatures to prevent replay attacks
    event SignatureUsed(bytes32 indexed signatureHash);

    // Mapping to track used signatures
    mapping(bytes32 => bool) public usedSignatures;

    bytes32 constant BUY_TOKENS_MESSAGE_TYPEHASH =
        keccak256(
            "BuyTokensMessage(address paymentToken,uint256 amountPaid,uint256 amountReceived,uint256 timeSigned,uint256 salt)"
        );
    bytes32 constant BUY_TOKENS_WITH_ETH_MESSAGE_TYPEHASH =
        keccak256(
            "BuyTokensWithEthMessage(uint256 amountPaid,uint256 amountReceived,uint256 timeSigned,uint256 salt)"
        );

    constructor(
        address _adminSigner,
        address _treasury,
        uint256 _tokenSaleHardCap
    ) EIP712("PresaleRegister", "1") Ownable(msg.sender) {
        require(_adminSigner != address(0), "Invalid admin signer address");
        require(_treasury != address(0), "Invalid treasury address");
        require(_tokenSaleHardCap > 0, "Invalid token sale hard cap");
        adminSigner = _adminSigner;
        treasury = _treasury;
        tokenSaleHardCap = _tokenSaleHardCap;
    }

    function buyTokens(
        address _paymentToken,
        uint256 _amountPaid,
        uint256 _amountReceived,
        uint32 _timeSigned,
        uint256 _salt,
        bytes memory _signedMessage
    ) external whenNotPaused {
        require(
            tokensSold + _amountReceived <= tokenSaleHardCap,
            "Token sale hard cap reached"
        );

        // Verify the signature hasn't been used
        bytes32 signatureHash = keccak256(abi.encodePacked(_signedMessage));
        require(!usedSignatures[signatureHash], "Signature already used");

        // Verify message parameters
        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    BUY_TOKENS_MESSAGE_TYPEHASH,
                    _paymentToken,
                    _amountPaid,
                    _amountReceived,
                    _timeSigned,
                    _salt
                )
            )
        );
        address _signer = ECDSA.recover(digest, _signedMessage);
        require(_signer == adminSigner, "Invalid signature");

        // Verify timestamp is recent
        require(block.timestamp <= _timeSigned + 1 hours, "Signature expired");

        // Mark signature as used
        usedSignatures[signatureHash] = true;
        emit SignatureUsed(signatureHash);

        // Transfer payment tokens to treasury
        IERC20(_paymentToken).safeTransferFrom(
            msg.sender,
            treasury,
            _amountPaid
        );

        // Update totals
        userTotalTokens[msg.sender] += _amountReceived;
        tokensSold += _amountReceived;

        // Record purchase details
        userPurchases[msg.sender].push(
            Purchase({date: block.timestamp, purchaseAmount: _amountReceived})
        );

        // Emit purchase event
        emit TokensPurchased(
            msg.sender,
            _paymentToken,
            _amountPaid,
            _amountReceived,
            block.timestamp
        );
    }

    function buyTokensWithEth(
        uint256 _amountPaid,
        uint256 _amountReceived,
        uint32 _timeSigned,
        uint256 _salt,
        bytes memory _signedMessage
    ) external payable whenNotPaused {
        require(
            tokensSold + _amountReceived <= tokenSaleHardCap,
            "Token sale hard cap reached"
        );

        // Verify ETH amount matches signed amount
        require(msg.value == _amountPaid, "ETH amount mismatch");

        // Verify the signature hasn't been used
        bytes32 signatureHash = keccak256(abi.encodePacked(_signedMessage));
        require(!usedSignatures[signatureHash], "Signature already used");

        // Verify message parameters
        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    BUY_TOKENS_WITH_ETH_MESSAGE_TYPEHASH,
                    _amountPaid,
                    _amountReceived,
                    _timeSigned,
                    _salt
                )
            )
        );
        address _signer = ECDSA.recover(digest, _signedMessage);
        require(_signer == adminSigner, "Invalid signature");

        // Verify timestamp is recent
        require(block.timestamp <= _timeSigned + 1 hours, "Signature expired");

        // Mark signature as used
        usedSignatures[signatureHash] = true;
        emit SignatureUsed(signatureHash);

        // Transfer ETH to treasury
        (bool success, ) = treasury.call{value: msg.value}("");
        require(success, "ETH transfer failed");

        // Update totals
        userTotalTokens[msg.sender] += _amountReceived;
        tokensSold += _amountReceived;
        // Record purchase details
        userPurchases[msg.sender].push(
            Purchase({date: block.timestamp, purchaseAmount: _amountReceived})
        );

        // Emit purchase event
        emit TokensPurchased(
            msg.sender,
            address(0), // Use zero address to indicate ETH
            msg.value,
            _amountReceived,
            block.timestamp
        );
    }

    // Function to pause contract
    function pause() external onlyOwner {
        _pause();
    }

    // Function to unpause contract
    function unpause() external onlyOwner {
        _unpause();
    }

    // function to update admin signer
    function updateAdminSigner(address _newAdminSigner) external onlyOwner {
        adminSigner = _newAdminSigner;
    }

    // function to update treasury
    function updateTreasury(address _newTreasury) external onlyOwner {
        treasury = _newTreasury;
    }

    // function to update hard cap
    function updateHardCap(uint256 _newHardCap) external onlyOwner {
        tokenSaleHardCap = _newHardCap;
    }

    // View function to get user's purchase history
    function getUserPurchases(
        address _user
    ) external view returns (Purchase[] memory) {
        return userPurchases[_user];
    }

    // View function to get user's total CACHE received
    function getUserTotalTokens(address _user) external view returns (uint256) {
        return userTotalTokens[_user];
    }

    // Function to receive ETH
    receive() external payable {
        revert("Use buyTokensWithEth instead");
    }
}
