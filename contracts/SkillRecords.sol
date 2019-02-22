pragma solidity >=0.4.25 <0.6.0;

//User Basic Information
contract SkillRecords {

    //id counter 
    uint256 private _counter = 0 ;

    struct SkillRecord {
        uint256 id ;
        address userAddress ;
        string ipfsHash ;
        uint8 recordType ;
        uint8 status ;
        uint256 createdTimestamp ;
        uint256 modifiedTimestamp ;
    }
    struct WorkFlow {
        uint256 id ;
        address generateAddress ;
        address approveAddress ;
        string commentIpfsHash ;
        bool isApproved ;
        uint256 generatedTimestamp ;
        uint256 approvedTimestamp ;
    }

    //constant
    uint8 constant TYPE_PROJECT = 0 ;
    uint8 constant TYPE_EDU = 1 ;
    uint8 constant TYPE_SKILL = 2 ;
    uint8 constant TYPE_QUALIFI = 3 ;

    uint8 constant STATUS_APPROVED = 0;
    uint8 constant STATUS_WATING_USER_APPROVE = 1;
    uint8 constant STATUS_WATING_BELONGS_APPROVE = 2;
    uint8 constant STATUS_INVALID = 9;

    //skill ID => skill record
    mapping ( uint => SkillRecord ) private _skillRecords ;

    //skill ID => workflow
    mapping ( uint => WorkFlow ) private _workFlows ;

    //userAddress => skill ID
    mapping ( address => uint256[] ) private _skillsOfUser ;

    //generateAddress => skill ID
    mapping ( address => uint256[] ) private _workFlowsOfGenerator ;

    //approveAddress => skill ID
    mapping ( address => uint256[] ) private _workFlowsOfApprover ;

    //generate skill record( only belongs institution) todo belongs check
    function generateSkillRecordByBelongs(address _userAddress,string memory _ipfsHash,uint8 _recordType) public {
        uint id = _counter ;
        
        _skillRecords[id].id = id ;
        _skillRecords[id].userAddress = _userAddress ;
        _skillRecords[id].ipfsHash = _ipfsHash ;
        _skillRecords[id].recordType = _recordType ;
        _skillRecords[id].status = STATUS_WATING_USER_APPROVE;
        _skillRecords[id].createdTimestamp = block.timestamp ;
        _skillRecords[id].modifiedTimestamp = block.timestamp ;

        _skillsOfUser[_userAddress].push(id) ;

        _workFlows[id].id = id ;
        _workFlows[id].generateAddress = msg.sender ;
        _workFlows[id].approveAddress = _userAddress ;
        _workFlows[id].generatedTimestamp = block.timestamp ;

        _workFlowsOfGenerator[msg.sender].push(id) ;
        _workFlowsOfApprover[_userAddress].push(id) ;

        _counter++ ;        
    }

    //generate skill record( only user)
    function generateSkillRecordByUser(address _belongsAddress,string memory _ipfsHash,uint8 _recordType) public {
        uint id = _counter ;
        
        _skillRecords[id].id = id ;
        _skillRecords[id].userAddress = msg.sender ;
        _skillRecords[id].ipfsHash = _ipfsHash ;
        _skillRecords[id].recordType = _recordType ;
        _skillRecords[id].status = STATUS_WATING_BELONGS_APPROVE ;
        _skillRecords[id].createdTimestamp = block.timestamp ;
        _skillRecords[id].modifiedTimestamp = block.timestamp ;

        _skillsOfUser[msg.sender].push(id) ;

        _workFlows[id].id = id ;
        _workFlows[id].generateAddress = msg.sender ;
        _workFlows[id].approveAddress = _belongsAddress ;
        _workFlows[id].generatedTimestamp = block.timestamp ;

        _workFlowsOfGenerator[msg.sender].push(id) ;
        _workFlowsOfApprover[_belongsAddress].push(id) ;

        _counter++ ;
    }

    //approve skill record
    function approve(uint _id,bool _isApproved,string memory _commentIpfsHash) public {
        require(_workFlows[_id].approveAddress == msg.sender,"approve conductor is wrong") ;
        
        if(_isApproved){
            _skillRecords[_id].status = STATUS_APPROVED ;
        }else{
            _skillRecords[_id].status = STATUS_INVALID ;
        }
        _skillRecords[_id].modifiedTimestamp = block.timestamp ;
        _workFlows[_id].isApproved = _isApproved ;
        _workFlows[_id].commentIpfsHash = _commentIpfsHash ;
        _workFlows[_id].approveAddress = msg.sender ;
        _workFlows[_id].approvedTimestamp = block.timestamp ;

    }

    //get skill record
    function getSkillRecord(uint _id) public view returns(
        address,string memory,uint8,uint8,uint256,uint256) {
        return (
            _skillRecords[_id].userAddress,
            _skillRecords[_id].ipfsHash,
            _skillRecords[_id].recordType,
            _skillRecords[_id].status,
            _skillRecords[_id].createdTimestamp,
            _skillRecords[_id].modifiedTimestamp
        ) ;
    }

    //get work flow
    function getWorkFlow(uint _id) public view returns(
        address,address,string memory,bool,uint256,uint256) {
        return (
            _workFlows[_id].generateAddress,
            _workFlows[_id].approveAddress,
            _workFlows[_id].commentIpfsHash,
            _workFlows[_id].isApproved,
            _workFlows[_id].generatedTimestamp,
            _workFlows[_id].approvedTimestamp
        ) ;
    }

    //get my own skill records
    function getMySkillRecords() public view returns(uint256[] memory) {
        return _skillsOfUser[msg.sender] ;
    }

    //get work flows which wait for approving
    function getPendingWorkFlowsByApprover() public view returns(uint256[] memory) {
        return _workFlowsOfApprover[msg.sender] ;
    }

    //get work flows generated msg.sender
    function getGeneratedWorkFlows() public view returns(uint256[] memory) {
        return _workFlowsOfGenerator[msg.sender] ;
    }

}
