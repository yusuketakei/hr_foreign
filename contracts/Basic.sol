pragma solidity >=0.4.25 <0.6.0;

//User Basic Information
contract Basic {

    struct BasicInfo {
        address userAddress ;
        string ipfsHash ;
        uint createdTimestamp ;
        uint modifiedTimeStamp ;
    }

    mapping ( address => BasicInfo ) private _basicInfoList ;
    
    event CreateUser(address userAddress,string ipfsHash) ;

    //create user's own info
    function createUser(string memory _ipfsHash) public {
        _basicInfoList[msg.sender].userAddress = msg.sender ;
        _basicInfoList[msg.sender].ipfsHash = _ipfsHash ;
        _basicInfoList[msg.sender].createdTimestamp = block.timestamp ;
        _basicInfoList[msg.sender].modifiedTimeStamp = block.timestamp ;
    
        emit CreateUser(msg.sender,_ipfsHash);
    }

    //create user's own info
    function modifyUserInfo(string memory _ipfsHash) public {
        _basicInfoList[msg.sender].ipfsHash = _ipfsHash ;
        _basicInfoList[msg.sender].modifiedTimeStamp = block.timestamp ;
    }

    function getUserInfo(address _userAddress) public view returns(address,string memory,uint,uint) {
        return(_basicInfoList[_userAddress].userAddress,
            _basicInfoList[_userAddress].ipfsHash,
            _basicInfoList[_userAddress].createdTimestamp,
            _basicInfoList[_userAddress].modifiedTimeStamp) ;
    }

}
