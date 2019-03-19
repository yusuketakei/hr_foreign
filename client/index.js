'use strict';

const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');

const app = express();
app.set('view engine', 'ejs');
app.use(express.static(__dirname + '/views'));
app.use(bodyParser.urlencoded({
    extended: true
}));
app.use(bodyParser.json());
app.use(session({
    secret: 'hr test',
    resave: false,
    saveUninitialized: true,
    cookie: {
        maxAge: 1000 * 60 * 60
    }
}));

const url = require('url');
const ejs = require('ejs');
const fs = require('fs');
const config = require('config');
const logDir = config.log_dir ;

const TYPE_PROJECT = 0 ;
const TYPE_EDU = 1 ;
const TYPE_SKILL = 2 ;
const TYPE_QUALIFI = 3 ;

const STATUS_APPROVED = 0;
const STATUS_WATING_USER_APPROVE = 1;
const STATUS_WATING_BELONGS_APPROVE = 2;
const STATUS_INVALID = 9;


//geth rpc設定
const Web3 = require('web3');
const web3 = new Web3(new Web3.providers.HttpProvider(config.geth_url));

//web3 libralies instead of web3.js
const ethers = require('ethers') ;
const rpcProvider = new ethers.providers.JsonRpcProvider(config.geth_url);

//IPFS API Client設定
const ipfsClient = require('ipfs-http-client');
var ipfs = ipfsClient({ host: 'localhost', port: '5001', protocol: 'http' }) ;

//from address
const fromAddress = config.from_address;
//gas
const gas = config.gas ;

//contract設定
var basicContract = new web3.eth.Contract(config.contract_basic_abi,config.contract_basic_address,{from:fromAddress});
var skillRecordsContract = new web3.eth.Contract(config.contract_skillRecords_abi,config.contract_skillRecords_address,{from:fromAddress});

app.all('*',function(req, res, next){
    res.header('Content-Type', 'text/plain;charset=utf-8');
    req.body.userId = getUserId(req) ;
    req.body.privateKey = getPrivateKeyByUserId(req.body.userId) ;
    next();
  }) ;
//一覧処理のget処理
app.get('/', async (req, res) => {
    const wallet = new ethers.Wallet(req.body.privateKey,rpcProvider) ;

    //パラメータを設定してejsをレンダリング
    //ejsに渡す用のパラメータをセットしてく
    var ejsParams = {};

    ejsParams["userInfo"] = await getUserInfo(wallet.address) ;

    //SkillRecordsから自分の保持するスキルを取得する(承認前のものも含めて取得)
    var skillRecordArray = await getMySkillRecords(wallet.address) ;
    ejsParams["skillRecordArray"] = skillRecordArray ;
    ejsParams["skillRecordArray.length"] = skillRecordArray.length ;

    //express4でejsテンプレートを読み込むための呪文
    ejsParams["filename"] = "filename";
    //navbar用
    ejsParams["navActive"] = "/";
    //レンダリング
    fs.readFile('./views/index.ejs', 'utf-8', function (err, data) {
        renderEjsView(res, data, ejsParams);
    });
});

app.get('/registerProject', async (req, res) => {
    const wallet = new ethers.Wallet(req.body.privateKey,rpcProvider) ;

    var recordType = TYPE_PROJECT ;
    
    //パラメータを設定してejsをレンダリング
    //ejsに渡す用のパラメータをセットしてく
    var ejsParams = {};

    ejsParams["userInfo"] = await getUserInfo(wallet.address) ;

    //express4でejsテンプレートを読み込むための呪文
    ejsParams["filename"] = "filename";
    //navbar用
    ejsParams["navActive"] = "/registerProject";

    fs.readFile('./views/registerProject.ejs', 'utf-8', function (err, data) {
        renderEjsView(res, data, ejsParams);
    });
});

app.post('/doRegisterProject', async (req, res) => {
    //walletの生成
    const wallet = new ethers.Wallet(req.body.privateKey,rpcProvider) ;
    
    //登録する情報の取得
    var skillRecordToIpfs = {} ;
    skillRecordToIpfs.company = req.body.company ;
    skillRecordToIpfs.startDate = formatDateYYYYMMDD(req.body.startDateYear,req.body.startDateMonth,req.body.startDateDay) ;
    skillRecordToIpfs.endDate = formatDateYYYYMMDD(req.body.endDateYear,req.body.endDateMonth,req.body.endDateDay) ;
    skillRecordToIpfs.job = req.body.job ;
    skillRecordToIpfs.position = req.body.position ;
    var employeeAddress = new ethers.Wallet(getPrivateKeyByUserId(req.body.employeeUserId)).address ;
    skillRecordToIpfs.userAddress = employeeAddress ;

    //IPFSにユーザー情報を書き込み
    var ipfsHash = await writeJsonToIpfs(JSON.stringify(skillRecordToIpfs)) ;
 
    //書き込んだHashをBasicInfoに登録
    await registerSkillRecordToContractByBelongs(skillRecordsContract,wallet,employeeAddress,ipfsHash,TYPE_PROJECT) ;

    //ejsに渡す用のパラメータをセットしてく
    var ejsParams = {};
    ejsParams["userInfo"] = await getUserInfo(wallet.address) ;
    //express4でejsテンプレートを読み込むための呪文
    ejsParams["filename"] = "filename";
    //navbar用
    ejsParams["navActive"] = "/registerProject";

    //リダイレクト
    return res.redirect('/');
});

//スキルの詳細情報を表示するとともに、自身が承認者の場合承認/否認を可能とする
app.get('/getSkillRecord', async (req, res) => {
    const wallet = new ethers.Wallet(req.body.privateKey,rpcProvider) ;
    
    //skill recordのidをクエリから取得
    var url_parts = url.parse(req.url, true);
    var id = url_parts.query.id ;

    //詳細画面でのApprove実行用にSessionにskillRecordIdを持たせておく
    req.session.approveSkillRecordId = id ;

    //パラメータを設定してejsをレンダリング
    //ejsに渡す用のパラメータをセットしてく
    var ejsParams = {};

    ejsParams["skillRecord"] = await getSkillRecordById(id) ;
    ejsParams["skillRecordKeys"] = Object.keys(ejsParams["skillRecord"]) ;

    //自分自身が承認者(Approver)かどうか確認、スタータスが未承認であればapproveが必要
    ejsParams["hasToApprove"] = hasToApprove(ejsParams["skillRecord"].status,await isWorkflowApprover(id,wallet.address)) ;

    ejsParams["userInfo"] = await getUserInfo(wallet.address) ;
    
    //express4でejsテンプレートを読み込むための呪文
    ejsParams["filename"] = "filename";
    //navbar用
    ejsParams["navActive"] = "/";
    //レンダリング
    fs.readFile('./views/skillRecordDetail.ejs', 'utf-8', function (err, data) {
        renderEjsView(res, data, ejsParams);
    });
});

app.post('/approveSkillRecord', async (req, res) => {
    //walletの生成
    const wallet = new ethers.Wallet(req.body.privateKey,rpcProvider) ;

    //セッションからとapprove用のskillRecordIdを取得
    var approveSkillRecordId = req.session.approveSkillRecordId ;
    
    //approveボタンとdenyボタンのどちらが押されたか判別
    var isApproved ;
    if(req.body.hasOwnProperty('doApprove')){
        //approve
        isApproved = true ;
    }else{
        //deny
        isApproved = false ;
    }

    //reqからcommentを取り出す
    var commentJson = {} ;
    commentJson.comment = req.body.comment ;

    //commentをIPFSに登録
    var ipfsHash = await writeJsonToIpfs(JSON.stringify(commentJson)) ;

    //skillRecordのapproveを実行
    await approveSkillRecord(skillRecordsContract,wallet,approveSkillRecordId,isApproved,wallet.address,ipfsHash) ;

    //ejsに渡す用のパラメータをセットしてく
    var ejsParams = {};
    ejsParams["userInfo"] = await getUserInfo(wallet.address) ;
    //express4でejsテンプレートを読み込むための呪文
    ejsParams["filename"] = "filename";
    //navbar用
    ejsParams["navActive"] = "/registerProject";

    //リダイレクト
    return res.redirect('/');

});

app.get('/myInfo', async (req, res) => {
    const wallet = new ethers.Wallet(req.body.privateKey,rpcProvider) ;
    
    //パラメータを設定してejsをレンダリング
    //ejsに渡す用のパラメータをセットしてく
    var ejsParams = {};

    ejsParams["userInfo"] = await getUserInfo(wallet.address) ;
    ejsParams["userInfo"].userId = req.body.userId ;
    
    //express4でejsテンプレートを読み込むための呪文
    ejsParams["filename"] = "filename";
    //navbar用
    ejsParams["navActive"] = "/";
    //レンダリング
    fs.readFile('./views/myInfo.ejs', 'utf-8', function (err, data) {
        renderEjsView(res, data, ejsParams);
    });
});

app.get('/generateUser', async (req, res) => {
    const wallet = new ethers.Wallet(req.body.privateKey,rpcProvider) ;
    
    //パラメータを設定してejsをレンダリング
    //ejsに渡す用のパラメータをセットしてく
    var ejsParams = {};

    var userInfo = {}
    userInfo.userName = "未設定" ;
    
    ejsParams["userInfo"] = userInfo ;

    //express4でejsテンプレートを読み込むための呪文
    ejsParams["filename"] = "filename";
    //navbar用
    ejsParams["navActive"] = "/generateUser";
    //レンダリング
    fs.readFile('./views/generateUser.ejs', 'utf-8', function (err, data) {
        renderEjsView(res, data, ejsParams);
    });
});

app.post('/doGenerateUser', async (req, res) => {
    //walletの生成
    const wallet = new ethers.Wallet(req.body.privateKey,rpcProvider) ;
    
    //登録する情報の取得
    var basicInfoToIpfs = {} ;
    basicInfoToIpfs.firstName = req.body.firstName ;
    basicInfoToIpfs.lastName = req.body.lastName ;
    basicInfoToIpfs.country = req.body.country ;
    basicInfoToIpfs.realAddress = req.body.realAddress ;
    basicInfoToIpfs.userName = req.body.firstName + " " + req.body.lastName ;
    basicInfoToIpfs.userAddress = wallet.address ;

    //IPFSにユーザー情報を書き込み
    var ipfsHash = await writeJsonToIpfs(JSON.stringify(basicInfoToIpfs)) ;
 
    //書き込んだHashをBasicInfoに登録
    var result = await registerBasicInfoToContract(basicContract,wallet,ipfsHash) ;

    //ejsに渡す用のパラメータをセットしてく
    var ejsParams = {};
    ejsParams["userInfo"] = basicInfoToIpfs ;
    //express4でejsテンプレートを読み込むための呪文
    ejsParams["filename"] = "filename";
    //navbar用
    ejsParams["navActive"] = "/generateUser";

    //リダイレクト
    return res.redirect('/');

});

//userIdを取得
function getUserId(req){
    //getパラメータを取得
    var url_parts = url.parse(req.url, true);

    var userId ;
    if (url_parts.query.userId){
        userId = url_parts.query.userId ;
        req.session.userId = userId ;
    }
    //sessionからaccountを取得
    else if (req.session.userId) {
        userId = req.session.userId;
    }
    return userId ;
}

//private keyを取得
function getPrivateKeyByUserId(userId){
    return config.user_map[userId] ;
}

//対象userAddressによるApproveが必要かどうか確認する
function hasToApprove(status,isWorkflowApprover){
    if(status == STATUS_APPROVED){
        return false ;
    }else if(status == STATUS_INVALID){
        return false ;
    }else{
        if(isWorkflowApprover){
            return true ;
        }
        else{
            return false ;
        }
    }
}

//対象userAddressがApproverかどうか確認する
async function isWorkflowApprover(id,userAddress){
    var workflow = await getWorkflowFromContractById(skillRecordsContract,id) ;
    return workflow.approveAddress == userAddress ;
}

//SkillRecordから自分が持つスキルの一覧を取得する
async function getMySkillRecords(userAddress){
    //自分が持つSkill IDの一覧を取得
    var skillIdArray = await getMySkillRecordsFromContract(skillRecordsContract,userAddress) ;
    var skillRecordArray = { "array":[] } ;
    var promiseArray = []
    for(var i=0;i<skillIdArray.length;i++){
        promiseArray.push(
            putSkillRecordToArrayById(skillIdArray[i],skillRecordArray)
        );
    }
    await Promise.all(promiseArray) ;

    return skillRecordArray.array ;
}

async function putSkillRecordToArrayById(skillId,skillRecordArray){
    var skillRecord = await getSkillRecordById(skillId) ;
    //object.arrayの形でarrayを渡す
    skillRecordArray.array.push(skillRecord) ;
    return ;
}

//SkillRecordからHashを取得し、IPFSから情報を取得する
async function getSkillRecordById(id){
    //contractからSkillRecordを取得
    var contractSkillRecord = await getSkillRecordFromContractById(skillRecordsContract,id);

    //SkillRecordのipfs hashにあたるipfs contentsからjsonを抽出し、ユーザー情報として保持
    var skillRecord = await readJsonFromIpfs(contractSkillRecord.ipfsHash) ;
    skillRecord.id = id ;
    skillRecord.recordType = contractSkillRecord.recordType ;
    skillRecord.status = contractSkillRecord.status ;
    skillRecord.createdTimestamp = contractSkillRecord.createdTimestamp ;
    skillRecord.updatedTimestamp = contractSkillRecord.updatedTimestamp ;

    return skillRecord ;
}

//BasicContractからHashを取得し、IPFSからUserInfoを取得する
async function getUserInfo(userAddress){
    //contractからBasicInfoを取得
    var basicInfo = await getBasicInfoFromContract(basicContract,userAddress);

    //BasicInfoのipfs hashにあたるipfs contentsからjsonを抽出し、ユーザー情報として保持
    var userInfo = {}
    userInfo = await readJsonFromIpfs(basicInfo.ipfsHash) ;
    userInfo.userAddress = basicInfo.userAddress;
    return userInfo ;
}

//Contractから自分が持つSKillIdの一覧を取得する
async function getMySkillRecordsFromContract(contract,userAddress){
    return await contract.methods.getMySkillRecords().call({from:userAddress},function(err,result){
        if(err){
            console.log(err) ;
        }
        //コンバージョンする
        return result
    }) ;
}

//ContractからSkillRecordを取得する
async function getSkillRecordFromContractById(contract,id){
    var skillRecord = {}
    await contract.methods.getSkillRecord(id).call({},function(err,result){
        if(err){
            console.log(err) ;
        }
        //コンバージョンする
        skillRecord.userAddress = result[0] ;
        skillRecord.ipfsHash = result[1]
        skillRecord.recordType = parseInt(result[2],10);
        skillRecord.status = parseInt(result[3],10);
        skillRecord.createdTimestamp = getEpochTimeFromBlockTimestamp(parseInt(result[4],10));
        skillRecord.createdTimestamp = getEpochTimeFromBlockTimestamp(parseInt(result[5],10));
    }) ;
    return skillRecord ;
}

//ContractからSkillRecordのWorkflowを取得する
async function getWorkflowFromContractById(contract,id){
    var workflow = {}
    await contract.methods.getWorkFlow(id).call({},function(err,result){
        if(err){
            console.log(err) ;
        }
        //コンバージョンする
        workflow.generateAddress = result[0] ;
        workflow.approveAddress = result[1] ;
        workflow.commentIpfsHash = result[2] ;
        workflow.isApproved = result[3] ;
        workflow.generatedTimestamp = getEpochTimeFromBlockTimestamp(parseInt(result[4],10));
        workflow.approvedTimestamp = getEpochTimeFromBlockTimestamp(parseInt(result[5],10));
    }) ;

    return workflow ;
}

//ContractからbasicInfoを取得する
async function getBasicInfoFromContract(contract,userAddress){
    var basicInfo = {}
    await contract.methods.getUserInfo(userAddress).call({},function(err,result){
        if(err){
            console.log(err) ;
        }
        //コンバージョンする
        basicInfo.userAddress = result[0] ;
        basicInfo.ipfsHash = result[1]
        basicInfo.createdTimestamp = getEpochTimeFromBlockTimestamp(parseInt(result[2],10));
        basicInfo.createdTimestamp = getEpochTimeFromBlockTimestamp(parseInt(result[3],10));
    }) ;
    return basicInfo ;
}


//ContractにbasicInfoを登録する
//pkを使ってsendするバージョン
async function registerBasicInfoToContract(contract,wallet,ipfsHash){
    const contractTxObj = contract.methods.createUser(ipfsHash) ;
    await sendContractTxObjWithPK(contract,contractTxObj,wallet) ;
}

//Contractにskill recordを登録する
async function registerSkillRecordToContractByBelongs(contract,wallet,userAddress,ipfsHash,recordType){
    const contractTxObj = contract.methods.generateSkillRecordByBelongs(userAddress,ipfsHash,recordType) ;
    await sendContractTxObjWithPK(contract,contractTxObj,wallet) ;
}

//Contract上でSkillRecordをapproveする
async function approveSkillRecord(contract,wallet,skillRecordId,isApproved,ipfsHash){
    const contractTxObj = contract.methods.approve(skillRecordId,isApproved,ipfsHash) ;
    await sendContractTxObjWithPK(contract,contractTxObj,wallet) ;
}

//ContractのMethodsを特定のPrivate Keyを使ってSendする
//contractTxObj=contract.methods.myMethods(any parameter)
async function sendContractTxObjWithPK(contract,contractTxObj,wallet){
    //nonce の取得
    const nonce = await wallet.getTransactionCount() ;
    //transaction objの生成
    const tx = {
        nonce,
        gasPrice: config.gas_price,
        gasLimit: config.gas,
        chainId: config.chain_id,
        to: contract.options.address,
        value: 0
    } ;
    tx.data = await contractTxObj.encodeABI() ;

    //sign transaction
    const signedTx = await wallet.sign(tx) ;

    //send Signed Transaction
    return await wallet.provider.sendTransaction(signedTx) ;
}

//IPFSへのJSONデータ出力(hashを返す)
async function writeJsonToIpfs(jsonData){
    var addContent = ipfs.types.Buffer.from(jsonData) ;
    var addResult = await ipfs.add([ {path: "", content: addContent} ]);
    return addResult[0].hash ;
}

async function readJsonFromIpfs(hash){
    if(!validateForIpfsHash(hash)){
        return {} ;
    } 
    //IPFS hashからJSONファイルを読み込む
    var data = await ipfs.cat(hash);
    return JSON.parse(data.toString()) ;
}

//IPFS Hash validate
function validateForIpfsHash(ipfsHash){
    return ipfsHash.slice(0,2) == "Qm" && ipfsHash.length > 2;
}

//日付format
function formatDateYYYYMMDD(yearStr,monthStr,dayStr){
    var yearPart = ('0000' + yearStr).slice(-4);
    var monthPart = ('00' + monthStr).slice(-2);
    var dayPart = ('00' + dayStr).slice(-2);
    return yearPart + monthPart + dayPart;
}

//block timestampからepochの日時(msec単位)を取得する
function getEpochTimeFromBlockTimestamp(blockTimeStamp){
	return blockTimeStamp.toString().substr(0,10) + "000" ;
}

//ejs render
function renderEjsView(res, data, ejsParams) {
    var view = ejs.render(data, ejsParams);
    res.writeHead(200, {
        'Content-Type': 'text/html'
    });
    res.write(view);
    res.end();
}

//server side側のlogをファイルに出力
function loger(log){
    //debug用にconsole出力
    console.log(log) ;    
      
    //TODO ファイルパスの生成(とりあず今はファイル名固定)
    var filepath = logDir + "/server.log"
    
    fs.appendFile(filepath, log+"\n",{encoding: 'utf-8'} , function (err) {
          if(err){
              console.log(err);
          }
      });  
  }

if (module === require.main) {
    // [START server]
    // Start the server
    const server = app.listen(process.env.PORT || 8081, () => {
        const port = server.address().port;
        console.log(`App listening on port ${port}`);
    });
    // [END server]
}

module.exports = app;